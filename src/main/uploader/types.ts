export interface UploadResult {
  videoId: string;
}

export interface UploadMeta {
  title: string;
  description: string;
  tags: string[];
  publishAt: string;
  madeForKids: boolean;
  language: string;
  categoryId: string;
}

export interface UploaderPlugin {
  readonly name: string;
  upload(filePath: string, meta: UploadMeta): Promise<UploadResult>;
}
