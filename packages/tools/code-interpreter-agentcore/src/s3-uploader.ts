import type { ExecutionResult } from "@obsku/tool-code-interpreter";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getErrorMessage, debugLog } from "@obsku/framework";

export interface S3UploadConfig {
  /** S3 bucket name */
  bucket: string;
  /** Optional key prefix (e.g., "executions/") */
  prefix?: string;
  /** AWS region for S3 (defaults to us-east-1) */
  region?: string;
}

export interface UploadResult {
  /** S3 object key */
  key: string;
  /** Original local file path */
  localPath: string;
  /** S3 HTTPS URL */
  url: string;
}

export class S3Uploader {
  private client: S3Client;
  private bucket: string;
  private prefix: string;
  private region: string;

  constructor(config: S3UploadConfig) {
    this.region = config.region ?? "us-east-1";
    this.bucket = config.bucket;
    this.prefix = config.prefix ?? "";
    this.client = new S3Client({ region: this.region });
  }

  /**
   * Upload output files and stdout to S3
   * @param files Array of output file paths
   * @param stdout stdout content
   * @param sessionId Session ID for organizing uploads
   * @returns Array of upload results with S3 URLs
   */
  async upload(
    files: Array<{ content?: Uint8Array; path: string }>,
    stdout: string,
    sessionId: string
  ): Promise<Array<UploadResult>> {
    const results: Array<UploadResult> = [];

    // Upload stdout as stdout.txt
    const stdoutKey = `${this.prefix}${sessionId}/stdout.txt`;
    await this.uploadString(stdout, stdoutKey, "text/plain");
    results.push({
      key: stdoutKey,
      localPath: "stdout",
      url: this.buildUrl(stdoutKey),
    });

    // Upload each output file
    for (const file of files) {
      const filename = file.path.split("/").pop() ?? file.path;
      const key = `${this.prefix}${sessionId}/${filename}`;

      try {
        if (file.content) {
          await this.uploadBuffer(file.content, key);
        } else {
          // If no content buffer, we can't upload (file wasn't fetched)
          debugLog(`s3_upload_skip: file=${filename} reason=no_content`);
          continue;
        }

        results.push({
          key,
          localPath: file.path,
          url: this.buildUrl(key),
        });

        debugLog(`s3_upload_success: file=${filename} key=${key}`);
      } catch (error: unknown) {
        const errorMsg = getErrorMessage(error);
        throw new Error(`S3 upload failed for ${filename}: ${errorMsg}`);
      }
    }

    debugLog(`s3_upload_complete: files=${results.length} session=${sessionId}`);
    return results;
  }

  private async uploadBuffer(buffer: Uint8Array, key: string): Promise<void> {
    const upload = new Upload({
      client: this.client,
      params: {
        Body: buffer,
        Bucket: this.bucket,
        Key: key,
      },
    });

    await upload.done();
  }

  private async uploadString(content: string, key: string, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Body: content,
        Bucket: this.bucket,
        ContentType: contentType,
        Key: key,
      })
    );
  }

  private buildUrl(key: string): string {
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  /**
   * Upload execution result files and annotate stdout with S3 URLs.
   */
  async uploadResult(result: ExecutionResult, sessionId: string): Promise<ExecutionResult> {
    const files = Array.from(result.outputFiles?.entries() ?? []).map(([path, content]) => ({
      content,
      path,
    }));
    try {
      const uploadResults = await this.upload(files, result.stdout, sessionId);
      debugLog(`s3_upload_summary: session=${sessionId} files=${uploadResults.length}`);
      const s3Urls = uploadResults
        .filter((u) => u.localPath !== "stdout")
        .map((u) => `  - ${u.localPath}: ${u.url}`)
        .join("\n");
      return {
        ...result,
        stdout:
          result.stdout +
          `\n\n[S3 Upload] Outputs uploaded to: https://${this.bucket}.s3.${this.region}.amazonaws.com/${this.prefix}${sessionId}/\n${s3Urls}`,
      };
    } catch (error: unknown) {
      const errorMsg = getErrorMessage(error);
      debugLog(`s3_upload_failed: session=${sessionId} error=${errorMsg}`);
      return { ...result, stdout: result.stdout + `\n\n[S3 Upload Error] ${errorMsg}` };
    }
  }
}
