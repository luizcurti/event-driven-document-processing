export interface ObjectStorage {
  generateUploadUrl(input: {
    bucket: string;
    key: string;
    contentType: string;
    expiresInSeconds?: number;
  }): Promise<string>;
}
