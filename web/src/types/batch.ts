export type BatchResult = {
  index: number;
  filename: string;
  success: boolean;
  originalUrl: string;
  image?: string;
  error?: string;
};
