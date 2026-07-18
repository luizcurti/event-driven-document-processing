export class DocumentId {
  private constructor(private readonly value: string) {}

  static from(raw: string): DocumentId {
    if (!raw || raw.trim().length < 8) {
      throw new Error("Invalid document id");
    }
    return new DocumentId(raw.trim());
  }

  toString(): string {
    return this.value;
  }
}
