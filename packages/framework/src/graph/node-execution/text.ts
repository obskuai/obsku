import type { ContentBlock } from "../../types";
import { BlockType } from "../../types/constants";

export function extractText(content: Array<ContentBlock>): string {
  return content
    .filter(
      (block): block is { text: string; type: typeof BlockType.TEXT } =>
        block.type === BlockType.TEXT
    )
    .map((block) => block.text)
    .join("");
}
