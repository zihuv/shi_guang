import fs from "node:fs/promises";

function isWhitespace(char: string): boolean {
  return /\s/u.test(char);
}

function isControl(char: string): boolean {
  if (char === "\t" || char === "\n" || char === "\r") {
    return false;
  }
  return /\p{Cc}|\p{Cf}/u.test(char);
}

function isPunctuation(char: string): boolean {
  return /[\p{P}\p{S}]/u.test(char);
}

function isCjk(char: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char);
}

function basicTokenize(text: string): string[] {
  const normalized = text.normalize("NFKC").toLowerCase();
  const tokens: string[] = [];
  let current = "";

  for (const char of normalized) {
    if (isControl(char)) {
      continue;
    }
    if (isWhitespace(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    if (isCjk(char) || isPunctuation(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      tokens.push(char);
      continue;
    }
    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

export class BertWordPieceTokenizer {
  private readonly vocab: Map<string, number>;
  private readonly clsId: number;
  private readonly sepId: number;
  private readonly padId: number;
  private readonly unkId: number;

  constructor(
    vocab: Map<string, number>,
    private readonly contextLength: number,
  ) {
    this.vocab = vocab;
    this.clsId = vocab.get("[CLS]") ?? 101;
    this.sepId = vocab.get("[SEP]") ?? 102;
    this.padId = vocab.get("[PAD]") ?? 0;
    this.unkId = vocab.get("[UNK]") ?? 100;
  }

  static async fromFile(vocabPath: string, contextLength: number): Promise<BertWordPieceTokenizer> {
    const vocabText = await fs.readFile(vocabPath, "utf8");
    const vocab = new Map<string, number>();
    for (const [index, line] of vocabText.split(/\r?\n/u).entries()) {
      const token = line.trim();
      if (!token) {
        continue;
      }
      vocab.set(token, index);
    }
    return new BertWordPieceTokenizer(vocab, contextLength);
  }

  encode(text: string): {
    inputIds: Int32Array;
    attentionMask: Int32Array;
    tokenTypeIds: Int32Array;
    tokenCount: number;
  } {
    const inputIds = new Int32Array(this.contextLength);
    const attentionMask = new Int32Array(this.contextLength);
    const tokenTypeIds = new Int32Array(this.contextLength);

    inputIds.fill(this.padId);
    inputIds[0] = this.clsId;
    attentionMask[0] = 1;

    const maxPieces = Math.max(0, this.contextLength - 2);
    const wordPieces: number[] = [];

    for (const token of basicTokenize(text)) {
      const pieces = this.wordPiece(token);
      for (const piece of pieces) {
        if (wordPieces.length >= maxPieces) {
          break;
        }
        wordPieces.push(piece);
      }
      if (wordPieces.length >= maxPieces) {
        break;
      }
    }

    let writeIndex = 1;
    for (const piece of wordPieces) {
      inputIds[writeIndex] = piece;
      attentionMask[writeIndex] = 1;
      writeIndex += 1;
    }

    if (writeIndex < this.contextLength) {
      inputIds[writeIndex] = this.sepId;
      attentionMask[writeIndex] = 1;
      writeIndex += 1;
    } else {
      inputIds[this.contextLength - 1] = this.sepId;
      attentionMask[this.contextLength - 1] = 1;
    }

    return {
      inputIds,
      attentionMask,
      tokenTypeIds,
      tokenCount: writeIndex,
    };
  }

  private wordPiece(token: string): number[] {
    if (!token) {
      return [];
    }

    if (this.vocab.has(token)) {
      return [this.vocab.get(token) ?? this.unkId];
    }

    const chars = Array.from(token);
    const pieces: number[] = [];
    let start = 0;

    while (start < chars.length) {
      let end = chars.length;
      let matchedId: number | null = null;

      while (end > start) {
        const piece = chars.slice(start, end).join("");
        const candidate = start === 0 ? piece : `##${piece}`;
        const tokenId = this.vocab.get(candidate);
        if (tokenId !== undefined) {
          matchedId = tokenId;
          break;
        }
        end -= 1;
      }

      if (matchedId == null) {
        return [this.unkId];
      }

      pieces.push(matchedId);
      start = end;
    }

    return pieces;
  }
}
