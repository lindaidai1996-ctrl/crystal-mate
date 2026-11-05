import { strFromU8, unzip, unzipSync, type Unzipped } from 'fflate';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { detectColumns } from './normalize';
import { MAX_EXCEL_BYTES, type ColumnMapping } from './contracts';

// Parse locally: embedded photographs never travel inside a JSON/API request.
type Xml = Record<string, unknown>;
const object = (value: unknown): Xml =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Xml) : {};
const array = (value: unknown): unknown[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];
const nodes = (value: unknown) => array(value).map(object);
const text = (value: unknown): string =>
  value === undefined || value === null
    ? ''
    : typeof value === 'object'
      ? text(object(value)['#text'])
      : String(value);
const attr = (node: Xml, name: string) => text(node[`@_${name}`]);
const child = (node: Xml, name: string) => object(node[name]);

export type WorkbookImage = { id: string; bytes: Uint8Array; fileName: string };
export type WorkbookRow = {
  rowNumber: number;
  cells: Record<string, string>;
  images: WorkbookImage[];
  imageErrors: string[];
};
export type WorkbookSheet = {
  name: string;
  rows: WorkbookRow[];
  headerRow: number;
  mapping: ColumnMapping;
};
export type ParsedWorkbook = { sheets: WorkbookSheet[] };
type Relationship = { path: string; external: boolean };

function resolvePart(base: string, target: string) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}
function relationshipPart(part: string) {
  const pieces = part.split('/');
  const file = pieces.pop()!;
  return [...pieces, '_rels', `${file}.rels`].join('/');
}
function richText(node: Xml) {
  return node.t !== undefined
    ? text(node.t)
    : nodes(node.r)
        .map((run) => text(run.t))
        .join('');
}
function flattenNodes(value: unknown, name: string): Xml[] {
  const result: Xml[] = [];
  for (const node of array(value)) {
    for (const [key, entry] of Object.entries(object(node))) {
      if (key === name) result.push(...nodes(entry));
      else if (!key.startsWith('@_')) result.push(...flattenNodes(entry, name));
    }
  }
  return result;
}

export function parseWorkbook(bytes: Uint8Array): ParsedWorkbook {
  if (!bytes.length || bytes.length > MAX_EXCEL_BYTES) throw new Error('EXCEL_FILE_TOO_LARGE');
  return parseFiles(unzipSync(bytes, unzipOptions()));
}

export async function parseWorkbookAsync(bytes: Uint8Array): Promise<ParsedWorkbook> {
  if (!bytes.length || bytes.length > MAX_EXCEL_BYTES) throw new Error('EXCEL_FILE_TOO_LARGE');
  const files = await new Promise<Unzipped>((resolve, reject) => {
    unzip(bytes, unzipOptions(), (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
  return parseFiles(files);
}

function unzipOptions() {
  let expanded = 0;
  let fileCount = 0;
  return {
    filter(file) {
      fileCount += 1;
      expanded += file.originalSize;
      if (fileCount > 5000 || expanded > 300 * 1024 * 1024 || file.originalSize > MAX_EXCEL_BYTES)
        throw new Error('EXCEL_FILE_TOO_LARGE');
      return /\.(?:xml|rels|png|jpe?g|webp|gif|bmp|tiff?)$/i.test(file.name);
    },
  } satisfies Parameters<typeof unzipSync>[1];
}

function parseFiles(files: Unzipped): ParsedWorkbook {
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
  });
  const xmlCache = new Map<string, Xml>();
  const read = (path: string): Xml => {
    if (xmlCache.has(path)) return xmlCache.get(path)!;
    const data = files[path];
    if (!data) return {};
    const source = strFromU8(data);
    if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(source) || XMLValidator.validate(source) !== true)
      throw new Error('EXCEL_INVALID_FILE');
    const result = object(parser.parse(source));
    xmlCache.set(path, result);
    return result;
  };
  const relationships = (part: string) =>
    new Map<string, Relationship>(
      nodes(child(read(relationshipPart(part)), 'Relationships').Relationship).map((rel) => [
        attr(rel, 'Id'),
        {
          path: resolvePart(part, attr(rel, 'Target')),
          external: attr(rel, 'TargetMode') === 'External',
        },
      ]),
    );
  const image = (rel: Relationship | undefined): WorkbookImage | null => {
    if (!rel || rel.external || !files[rel.path]) return null;
    const bytes = files[rel.path];
    return { id: rel.path, bytes, fileName: rel.path.split('/').at(-1)! };
  };
  const strings = nodes(child(read('xl/sharedStrings.xml'), 'sst').si).map(richText);
  const workbook = child(read('xl/workbook.xml'), 'workbook');
  const workbookRels = relationships('xl/workbook.xml');
  const sheets = nodes(child(workbook, 'sheets').sheet);
  if (!sheets.length || sheets.length > 30) throw new Error('EXCEL_INVALID_FILE');

  // WPS cell images refer to named pictures through DISPIMG("ID_…", 1).
  const wpsPictures = new Map<string, WorkbookImage>();
  for (const part of Object.keys(files).filter((path) => /(?:^|\/)cellimages\.xml$/i.test(path))) {
    const rels = relationships(part);
    for (const cellImage of flattenNodes(read(part), 'cellImage')) {
      const name = attr(flattenNodes(cellImage, 'cNvPr')[0] ?? {}, 'name');
      const blip = flattenNodes(cellImage, 'blip')[0];
      const picture = image(rels.get(attr(blip ?? {}, 'embed')));
      if (name && picture) wpsPictures.set(name, picture);
    }
  }

  // Modern Excel "Place in Cell": vm -> value metadata -> rich value -> image relation.
  const richDataPart = Object.keys(files).find((path) => /\/rdrichvalue\.xml$/i.test(path));
  const structurePart = Object.keys(files).find((path) =>
    /\/rdrichvaluestructure\.xml$/i.test(path),
  );
  const relPart = Object.keys(files).find((path) => /\/richvaluerel\.xml$/i.test(path));
  const richValues = richDataPart ? nodes(child(read(richDataPart), 'rvData').rv) : [];
  const structures = structurePart ? nodes(child(read(structurePart), 'rvStructures').s) : [];
  const richRels = relPart ? nodes(child(read(relPart), 'richValueRels').rel) : [];
  const richRelMap = relPart ? relationships(relPart) : new Map<string, Relationship>();
  const metadata = child(read('xl/metadata.xml'), 'metadata');
  const valueMetadata = nodes(child(metadata, 'valueMetadata').bk);
  const metadataTypes = nodes(child(metadata, 'metadataTypes').metadataType);
  const richMetadata = nodes(metadata.futureMetadata).find(
    (entry) => attr(entry, 'name') === 'XLRICHVALUE',
  );
  const richMetadataEntries = nodes(richMetadata?.bk);
  const cellImage = (vm: string): WorkbookImage | null => {
    const entry = valueMetadata[Number(vm) - 1];
    if (!entry) return null;
    const rc = nodes(entry.rc).find(
      (rc) => attr(metadataTypes[Number(attr(rc, 't')) - 1] ?? {}, 'name') === 'XLRICHVALUE',
    );
    if (!rc) return null;
    const index = attr(
      flattenNodes(richMetadataEntries[Number(attr(rc, 'v'))], 'rvb')[0] ?? {},
      'i',
    );
    if (index === '') return null;
    const value = richValues[Number(index)];
    if (!value) return null;
    const structure = structures[Number(attr(value, 's'))];
    const imageIndex = nodes(structure?.k).findIndex(
      (key) => attr(key, 'n') === '_rvRel:LocalImageIdentifier',
    );
    if (imageIndex < 0) return null;
    const relationIndex = Number(text(array(value.v)[imageIndex]));
    const relation = richRels[relationIndex];
    return image(richRelMap.get(attr(relation ?? {}, 'id')));
  };

  return {
    sheets: sheets.map((sheet) => {
      const relation = workbookRels.get(attr(sheet, 'id'));
      if (!relation || relation.external) throw new Error('EXCEL_INVALID_FILE');
      const part = relation.path;
      const worksheet = child(read(part), 'worksheet');
      const sheetRels = relationships(part);
      const rowMap = new Map<number, WorkbookRow>();
      const ensureRow = (rowNumber: number) => {
        if (!Number.isInteger(rowNumber) || rowNumber < 1 || rowNumber > 1048576)
          throw new Error('EXCEL_INVALID_FILE');
        if (!rowMap.has(rowNumber))
          rowMap.set(rowNumber, { rowNumber, cells: {}, images: [], imageErrors: [] });
        if (rowMap.size > 5000) throw new Error('EXCEL_TOO_MANY_ROWS');
        return rowMap.get(rowNumber)!;
      };
      for (const entry of nodes(child(worksheet, 'sheetData').row)) {
        const cells = nodes(entry.c);
        // Ignore formatting-only rows (often extending to Excel's final row).
        if (
          !cells.some(
            (cell) =>
              cell.v !== undefined ||
              cell.f !== undefined ||
              cell.is !== undefined ||
              attr(cell, 'vm'),
          )
        )
          continue;
        const row = ensureRow(Number(attr(entry, 'r')));
        if (cells.length > 200) throw new Error('EXCEL_TOO_MANY_COLUMNS');
        for (const cell of cells) {
          const column = attr(cell, 'r').replace(/\d/g, '');
          const value =
            attr(cell, 't') === 's'
              ? (strings[Number(text(cell.v))] ?? '')
              : attr(cell, 't') === 'inlineStr'
                ? richText(child(cell, 'is'))
                : attr(cell, 't') === 'b'
                  ? text(cell.v) === '1'
                    ? '是'
                    : '否'
                  : text(cell.v);
          const formula = text(cell.f);
          const dispimg = /(?:_xlfn\.)?DISPIMG\s*\(\s*"([^"]+)"/i.exec(formula);
          const vm = attr(cell, 'vm');
          let picture: WorkbookImage | null = null;
          if (dispimg) picture = wpsPictures.get(dispimg[1]) ?? null;
          else if (vm) picture = cellImage(vm);
          if (picture) row.images.push(picture);
          if ((dispimg || vm) && !picture) row.imageErrors.push(`${column}: CELL_IMAGE_MISSING`);
          if (/\bIMAGE\s*\(/i.test(formula) || /^https?:\/\//i.test(value)) {
            // Do not silently fetch arbitrary external URLs or confuse them with embedded cell images.
            if (/\bIMAGE\s*\(/i.test(formula)) row.imageErrors.push(`${column}: EXTERNAL_IMAGE`);
          }
          row.cells[column] = dispimg || vm ? '' : value;
          if (value.length > 10000) throw new Error('EXCEL_INVALID_FILE');
        }
      }
      // Also accept pictures anchored to cells by older Excel exports.
      for (const drawing of nodes(worksheet.drawing)) {
        const drawingRel = sheetRels.get(attr(drawing, 'id'));
        if (!drawingRel || drawingRel.external) continue;
        const drawingData = read(drawingRel.path);
        const rels = relationships(drawingRel.path);
        const root = child(drawingData, 'wsDr');
        for (const anchor of [...nodes(root.oneCellAnchor), ...nodes(root.twoCellAnchor)]) {
          const rowNumber = Number(text(child(anchor, 'from').row)) + 1;
          const blip = flattenNodes(anchor, 'blip')[0];
          if (!blip) continue;
          const row = ensureRow(rowNumber);
          const picture = image(rels.get(attr(blip, 'embed')));
          if (picture) row.images.push(picture);
          else row.imageErrors.push('CELL_IMAGE_MISSING');
        }
      }
      const rows = [...rowMap.values()].sort((a, b) => a.rowNumber - b.rowNumber);
      let headerRow = rows[0]?.rowNumber ?? 1;
      let mapping: ColumnMapping = {};
      for (const row of rows.slice(0, 30)) {
        const candidate = detectColumns(row.cells);
        if (Object.keys(candidate).length > Object.keys(mapping).length) {
          headerRow = row.rowNumber;
          mapping = candidate;
        }
      }
      for (const row of rows)
        row.images = [...new Map(row.images.map((picture) => [picture.id, picture])).values()];
      return { name: attr(sheet, 'name'), rows, headerRow, mapping };
    }),
  };
}
