export interface ObjectStorage {
  putObject(input: {
    bucket: string;
    key: string;
    contentBase64: string;
    contentType: string;
  }): Promise<void>;
}
