import { minimizeAssistantText } from './privacy';

// Use the first question directly; naming must not add a model request or delay the query.
export function assistantQuestionTitle(text: string) {
  const title = minimizeAssistantText(text).replace(/\s+/g, ' ').trim();
  const characters = Array.from(title);
  return characters.length > 32 ? `${characters.slice(0, 32).join('')}…` : title;
}
