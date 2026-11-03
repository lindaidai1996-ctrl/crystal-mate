'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ClientApiError } from '@/lib/client-api';
import { replaceAutomaticTags, type NameTagMatch } from '@/lib/name-tag-matching';
import { matchNameTags } from '@/lib/recognize-name-tags-client';

export function useNameTagRecognition({
  readName,
  readTags,
  writeTags,
}: {
  readName: () => string;
  readTags: () => string[];
  writeTags: (ids: string[], match: NameTagMatch, name: string) => void;
}) {
  const [matching, setMatching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingTags, setMissingTags] = useState<string[]>([]);
  const [matchedCount, setMatchedCount] = useState<number | null>(null);
  const request = useRef<{ controller: AbortController; name: string } | null>(null);
  const lastName = useRef<string | null>(null);
  const automatic = useRef<string[]>([]);
  const latest = useRef({ readName, readTags, writeTags });
  useLayoutEffect(() => {
    latest.current = { readName, readTags, writeTags };
  }, [readName, readTags, writeTags]);

  useEffect(() => () => request.current?.controller.abort(), []);

  function invalidate() {
    request.current?.controller.abort();
    request.current = null;
    lastName.current = null;
    setMatching(false);
    setError(null);
    setMissingTags([]);
    setMatchedCount(null);
  }
  function reset() {
    invalidate();
    automatic.current = [];
  }
  function manualChange(ids: string[]) {
    // A manual action while AI is running wins over the pending response.
    if (request.current) invalidate();
    automatic.current = automatic.current.filter((id) => ids.includes(id));
  }
  async function recognize(force = false) {
    const name = readName().trim();
    if (!name || (!force && (lastName.current === name || request.current?.name === name))) return;
    request.current?.controller.abort();
    const current = { controller: new AbortController(), name };
    request.current = current;
    setMatching(true);
    setError(null);
    setMissingTags([]);
    setMatchedCount(null);
    try {
      const [match] = await matchNameTags([name], current.controller.signal);
      if (
        request.current !== current ||
        current.controller.signal.aborted ||
        latest.current.readName().trim() !== name
      )
        return;
      const merged = replaceAutomaticTags(
        latest.current.readTags(),
        automatic.current,
        match.tagIds,
      );
      latest.current.writeTags(merged.tagIds, match, name);
      automatic.current = merged.automaticTagIds;
      lastName.current = name;
      setMissingTags(match.missingTags);
      setMatchedCount(match.tagIds.length);
    } catch (error) {
      if (request.current !== current || current.controller.signal.aborted) return;
      setError(error instanceof ClientApiError ? error.code : 'TAG_MODEL_UNAVAILABLE');
    } finally {
      if (request.current === current) {
        request.current = null;
        setMatching(false);
      }
    }
  }
  return {
    matching,
    error,
    missingTags,
    matchedCount,
    recognize,
    invalidate,
    reset,
    manualChange,
    isMatching: () => request.current !== null,
  };
}
