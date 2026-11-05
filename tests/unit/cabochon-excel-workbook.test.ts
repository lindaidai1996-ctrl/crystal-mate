import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parseWorkbook, parseWorkbookAsync } from '@/lib/cabochonExcelImport/workbook';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);
const workbook =
  '<workbook xmlns:r="relationships"><sheets><sheet name="蛋面" sheetId="1" r:id="rId1"/></sheets></workbook>';
const rels = (items: string) => `<Relationships>${items}</Relationships>`;
const relation = (id: string, target: string) => `<Relationship Id="${id}" Target="${target}"/>`;
const worksheet = (body: string, after = '') =>
  `<worksheet xmlns:r="relationships"><sheetData>${body}</sheetData>${after}</worksheet>`;
const header =
  '<row r="1"><c r="A1" t="inlineStr"><is><t>蛋面类型</t></is></c><c r="B1" t="inlineStr"><is><t>图片</t></is></c></row>';
function file(parts: Record<string, string | Uint8Array>) {
  const data = {
    'xl/workbook.xml': workbook,
    'xl/_rels/workbook.xml.rels': rels(relation('rId1', 'worksheets/sheet1.xml')),
    ...parts,
  };
  return zipSync(
    Object.fromEntries(
      Object.entries(data).map(([key, value]) => [
        key,
        typeof value === 'string' ? strToU8(value) : value,
      ]),
    ),
  );
}

describe('embedded workbook images', () => {
  it('parses embedded images through the asynchronous import path', async () => {
    const source = file({
      'xl/worksheets/sheet1.xml': worksheet(header, '<drawing r:id="draw1"/>'),
      'xl/worksheets/_rels/sheet1.xml.rels': rels(relation('draw1', '../drawings/drawing1.xml')),
      'xl/drawings/drawing1.xml':
        '<xdr:wsDr xmlns:xdr="d" xmlns:a="a" xmlns:r="r"><xdr:oneCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:row>1</xdr:row></xdr:from><xdr:pic><a:blip r:embed="pic1"/></xdr:pic></xdr:oneCellAnchor></xdr:wsDr>',
      'xl/drawings/_rels/drawing1.xml.rels': rels(relation('pic1', '../media/photo.png')),
      'xl/media/photo.png': png,
    });
    const result = await parseWorkbookAsync(source);
    expect(result.sheets[0].rows[1].images[0].bytes).toEqual(png);
  });
  it('reads inline/shared rich text and cached numeric formulas without evaluating code', () => {
    const result = parseWorkbook(
      file({
        'xl/sharedStrings.xml': '<sst><si><r><t>白</t></r><r><t>幽灵</t></r></si></sst>',
        'xl/worksheets/sheet1.xml': worksheet(
          header +
            '<row r="2"><c r="A2" t="s"><v>0</v></c><c r="C2"><f>10*2</f><v>20</v></c><c r="D2" t="b"><v>1</v></c></row>',
        ),
      }),
    ).sheets[0];
    expect(result).toMatchObject({
      name: '蛋面',
      headerRow: 1,
      mapping: { type: 'A', image: 'B' },
    });
    expect(result.rows[1].cells).toEqual({ A: '白幽灵', C: '20', D: '是' });
  });
  it('associates WPS DISPIMG with the correct row through picture names and relationships', () => {
    const result = parseWorkbook(
      file({
        'xl/worksheets/sheet1.xml': worksheet(
          header +
            '<row r="2"><c r="B2" t="str"><f>_xlfn.DISPIMG(&quot;ID_B&quot;,1)</f><v>#VALUE!</v></c></row><row r="3"><c r="B3"><f>DISPIMG("ID_A",1)</f></c></row>',
        ),
        'xl/cellimages.xml':
          '<etc:cellImages xmlns:etc="wps" xmlns:xdr="drawing" xmlns:a="a" xmlns:r="r"><etc:cellImage><xdr:pic><xdr:nvPicPr><xdr:cNvPr name="ID_A"/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="img1"/></xdr:blipFill></xdr:pic></etc:cellImage><etc:cellImage><xdr:pic><xdr:nvPicPr><xdr:cNvPr name="ID_B"/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="img2"/></xdr:blipFill></xdr:pic></etc:cellImage></etc:cellImages>',
        'xl/_rels/cellimages.xml.rels': rels(
          relation('img1', 'media/a.png') + relation('img2', 'media/b.png'),
        ),
        'xl/media/a.png': png,
        'xl/media/b.png': png,
      }),
    ).sheets[0];
    expect(result.rows[1].images[0].id).toBe('xl/media/b.png');
    expect(result.rows[2].images[0].id).toBe('xl/media/a.png');
    expect(result.rows[1].cells.B).toBe('');
    expect(result.rows[1].imageErrors).toEqual([]);
  });
  it('resolves modern Excel in-cell images using metadata and structure indexes rather than media order', () => {
    const result = parseWorkbook(
      file({
        'xl/worksheets/sheet1.xml': worksheet(
          header + '<row r="2"><c r="B2" t="e" vm="1"><v>#VALUE!</v></c></row>',
        ),
        'xl/metadata.xml':
          '<metadata><metadataTypes><metadataType name="XLRICHVALUE"/></metadataTypes><futureMetadata name="XLRICHVALUE"><bk><extLst><ext><rvb i="1"/></ext></extLst></bk></futureMetadata><valueMetadata><bk><rc t="1" v="0"/></bk></valueMetadata></metadata>',
        'xl/richData/rdrichvalue.xml':
          '<rvData><rv s="0"><v>0</v><v>0</v></rv><rv s="0"><v>ignored</v><v>1</v></rv></rvData>',
        'xl/richData/rdrichvaluestructure.xml':
          '<rvStructures><s><k n="other"/><k n="_rvRel:LocalImageIdentifier"/></s></rvStructures>',
        'xl/richData/richValueRel.xml':
          '<richValueRels xmlns:r="relationships"><rel r:id="rId1"/><rel r:id="rId2"/></richValueRels>',
        'xl/richData/_rels/richValueRel.xml.rels': rels(
          relation('rId1', '../media/a.png') + relation('rId2', '../media/b.png'),
        ),
        'xl/media/a.png': png,
        'xl/media/b.png': png,
      }),
    ).sheets[0].rows[1];
    expect(result.images[0].id).toBe('xl/media/b.png');
    expect(result.imageErrors).toEqual([]);
  });
  it('uses the from-row of anchored pictures, including image-only product rows', () => {
    const result = parseWorkbook(
      file({
        'xl/worksheets/sheet1.xml': worksheet(header, '<drawing r:id="draw1"/>'),
        'xl/worksheets/_rels/sheet1.xml.rels': rels(relation('draw1', '../drawings/drawing1.xml')),
        'xl/drawings/drawing1.xml':
          '<xdr:wsDr xmlns:xdr="d" xmlns:a="a" xmlns:r="r"><xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:row>3</xdr:row></xdr:from><xdr:pic><a:blip r:embed="pic1"/></xdr:pic></xdr:twoCellAnchor></xdr:wsDr>',
        'xl/drawings/_rels/drawing1.xml.rels': rels(relation('pic1', '../media/photo.png')),
        'xl/media/photo.png': png,
      }),
    ).sheets[0].rows[1];
    expect(result.rowNumber).toBe(4);
    expect(result.images[0].bytes).toEqual(png);
  });
  it('flags missing/external images without fetching or silently dropping them', () => {
    const result = parseWorkbook(
      file({
        'xl/worksheets/sheet1.xml': worksheet(
          header +
            '<row r="2"><c r="B2"><f>DISPIMG("missing",1)</f></c></row><row r="3"><c r="B3"><f>IMAGE("https://example.invalid/image.png")</f></c></row>',
        ),
      }),
    ).sheets[0];
    expect(result.rows[1].imageErrors).toEqual(['B: CELL_IMAGE_MISSING']);
    expect(result.rows[2].imageErrors).toEqual(['B: EXTERNAL_IMAGE']);
  });
  it('rejects non-workbooks, invalid XML and entity declarations', () => {
    expect(() => parseWorkbook(strToU8('not a zip'))).toThrow();
    expect(() => parseWorkbook(file({ 'xl/workbook.xml': '<broken' }))).toThrow(
      'EXCEL_INVALID_FILE',
    );
    expect(() =>
      parseWorkbook(
        file({ 'xl/workbook.xml': '<!DOCTYPE workbook [<!ENTITY x "boom">]>' + workbook }),
      ),
    ).toThrow('EXCEL_INVALID_FILE');
  });
});
