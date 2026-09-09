import { DocumentStatus } from "../../../../shared/domain/document-status";

export interface DocumentProps {
  id: string;
  originalFileName: string;
  contentType: string;
  status: DocumentStatus;
  createdAt: string;
}

export class Document {
  constructor(private readonly props: DocumentProps) {}

  static create(input: Omit<DocumentProps, "createdAt">): Document {
    return new Document({
      ...input,
      createdAt: new Date().toISOString()
    });
  }

  toPrimitives(): DocumentProps {
    return { ...this.props };
  }
}
