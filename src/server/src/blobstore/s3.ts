import { createReadStream } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { config } from '../config';
import { BlobStore } from './types';

function isNotFound(err: unknown): boolean {
  const e = err as { $metadata?: { httpStatusCode?: number }; name?: string };
  return (
    e?.$metadata?.httpStatusCode === 404 ||
    e?.name === 'NotFound' ||
    e?.name === 'NoSuchKey' ||
    e?.name === 'NoSuchBucket'
  );
}

// S3-совместимый объектный стор (MinIO в prod/deploy, готовое облако — позже).
// Ключ объекта = content-hash блоба. forcePathStyle — для MinIO/локального S3.
export class S3BlobStore implements BlobStore {
  private bucket = config.s3.bucket;
  private client = new S3Client({
    region: config.s3.region,
    endpoint: config.s3.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: config.s3.secretAccessKey,
    },
  });

  async init(): Promise<void> {
    // MinIO может стартовать чуть позже сервера — ретраим связь, затем
    // обеспечиваем наличие бакета (HeadBucket → CreateBucket).
    let lastErr: unknown;
    for (let attempt = 0; attempt < 15; attempt++) {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
        return;
      } catch (err) {
        if (isNotFound(err)) {
          await this.client.send(
            new CreateBucketCommand({ Bucket: this.bucket }),
          );
          return;
        }
        lastErr = err;
        await sleep(1000);
      }
    }
    throw lastErr;
  }

  async has(id: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: id }),
      );
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  async putFile(id: string, srcPath: string, size: number): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: id,
        Body: createReadStream(srcPath),
        ContentLength: size,
      }),
    );
  }

  async get(id: string): Promise<Readable | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: id }),
      );
      return res.Body as Readable;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }
}
