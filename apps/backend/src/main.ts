import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createWriteStream, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Socket } from 'node:net';
import type { IncomingMessage } from 'node:http';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingMiddleware } from './common/middleware/logging.middleware';
import { MeetingService } from './modules/meeting/meeting.service';

type AudioSession = {
  filePath: string;
  fileName: string;
  mimeType: string;
  durationMs: number;
  writeStream: ReturnType<typeof createWriteStream>;
  chunkCount: number;
  chunkBytes: number;
  startedAt: number;
};

const uploadsDir = join(process.cwd(), 'uploads');

if (!existsSync(uploadsDir)) {
  mkdirSync(uploadsDir, { recursive: true });
}

type WsFrame = {
  fin: boolean;
  opcode: number;
  payload: Buffer;
};

function createWebSocketAcceptValue(key: string): string {
  return createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');
}

function parseWebSocketFrames(buffer: Buffer): { frames: WsFrame[]; remaining: Buffer } {
  const frames: WsFrame[] = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const firstByte = buffer[offset];
    const secondByte = buffer[offset + 1];
    const fin = (firstByte & 0x80) === 0x80;
    const opcode = firstByte & 0x0f;
    const masked = (secondByte & 0x80) === 0x80;
    let payloadLength = secondByte & 0x7f;
    let headerLength = 2;

    if (payloadLength === 126) {
      if (offset + 4 > buffer.length) {
        break;
      }

      payloadLength = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (payloadLength === 127) {
      if (offset + 10 > buffer.length) {
        break;
      }

      const fullLength = Number(buffer.readBigUInt64BE(offset + 2));
      payloadLength = fullLength;
      headerLength = 10;
    }

    const maskBytesLength = masked ? 4 : 0;
    const frameLength = headerLength + maskBytesLength + payloadLength;
    if (offset + frameLength > buffer.length) {
      break;
    }

    let payload = buffer.subarray(offset + headerLength + maskBytesLength, offset + frameLength);

    if (masked) {
      const mask = buffer.subarray(offset + headerLength, offset + headerLength + 4);
      payload = Buffer.from(payload);

      for (let i = 0; i < payload.length; i += 1) {
        payload[i] ^= mask[i % 4];
      }
    }

    frames.push({ fin, opcode, payload });
    offset += frameLength;
  }

  return {
    frames,
    remaining: buffer.subarray(offset),
  };
}

function encodeTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const payloadLength = payload.length;

  if (payloadLength < 126) {
    return Buffer.concat([Buffer.from([0x81, payloadLength]), payload]);
  }

  if (payloadLength < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payloadLength, 2);
    return Buffer.concat([header, payload]);
  }

  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payloadLength), 2);
  return Buffer.concat([header, payload]);
}

function sendWsMessage(socket: Socket, payload: unknown) {
  const safePayload = JSON.stringify(payload);

  if (!safePayload) {
    socket.write(
      encodeTextFrame(JSON.stringify({ type: 'error', error: 'Failed to serialize websocket payload.' })),
    );
    return;
  }

  socket.write(encodeTextFrame(safePayload));
}

function parseCloseFramePayload(payload: Buffer) {
  if (payload.length < 2) {
    return { code: undefined, reason: '' };
  }

  const code = payload.readUInt16BE(0);
  const reason = payload.subarray(2).toString('utf8');
  return { code, reason };
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const bodySizeLimit = process.env.BODY_SIZE_LIMIT ?? '50mb';
  const defaultAllowedOrigins = ['http://localhost:3001', 'http://localhost:3000'];
  const configuredOrigins = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowedOrigins = new Set(
    (configuredOrigins.length > 0 ? configuredOrigins : defaultAllowedOrigins).map((origin) =>
      origin.replace(/\/$/, ''),
    ),
  );

  app.use(helmet());
  app.use(cookieParser());
  app.use(json({ limit: bodySizeLimit }));
  app.use(urlencoded({ extended: true, limit: bodySizeLimit }));
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 200,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.has(origin.replace(/\/$/, ''))) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  app.use(new LoggingMiddleware().use);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  const meetingService = app.get(MeetingService);
  const httpServer = app.getHttpServer();

  httpServer.on('upgrade', (request: IncomingMessage, socket: Socket) => {
    const streamId = randomUUID();
    console.info('[ws][backend]', streamId, 'upgrade request', {
      url: request.url,
      remoteAddress: socket.remoteAddress,
      remotePort: socket.remotePort,
    });

    if (request.url !== '/ws/audio-stream') {
      console.warn('[ws][backend]', streamId, 'upgrade rejected: unexpected url', { url: request.url });
      socket.destroy();
      return;
    }

    const key = request.headers['sec-websocket-key'];
    if (!key || typeof key !== 'string') {
      console.warn('[ws][backend]', streamId, 'upgrade rejected: missing websocket key');
      socket.destroy();
      return;
    }

    const acceptKey = createWebSocketAcceptValue(key);
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptKey}`,
        '\r\n',
      ].join('\r\n'),
    );
    console.info('[ws][backend]', streamId, 'upgrade accepted');

    let session: AudioSession | null = null;
    let dataBuffer = Buffer.alloc(0);
    let fragmentedMessage: Buffer | null = null;

    const cleanupSession = () => {
      if (!session) {
        return;
      }

      console.info('[ws][backend]', streamId, 'cleaning session', {
        fileName: session.fileName,
        chunkCount: session.chunkCount,
        chunkBytes: session.chunkBytes,
        durationMs: session.durationMs,
      });

      if (!session.writeStream.closed) {
        session.writeStream.end();
      }

      if (existsSync(session.filePath)) {
        unlinkSync(session.filePath);
      }

      session = null;
    };

    socket.on('data', (chunk) => {
      dataBuffer = Buffer.concat([dataBuffer, Buffer.from(chunk)]);
      const { frames, remaining } = parseWebSocketFrames(dataBuffer);
      dataBuffer = Buffer.from(remaining);

      for (const frame of frames) {
        if (frame.opcode === 0x8) {
          const closePayload = parseCloseFramePayload(frame.payload);
          console.warn('[ws][backend]', streamId, 'received close frame', {
            code: closePayload.code,
            reason: closePayload.reason || '(empty)',
          });
          cleanupSession();
          socket.end();
          return;
        }

        if (frame.opcode === 0x9) {
          socket.write(Buffer.from([0x8a, 0x00]));
          continue;
        }

        if (frame.opcode === 0x0) {
          if (!fragmentedMessage) {
            sendWsMessage(socket, { type: 'error', error: 'Invalid fragmented websocket message.' });
            continue;
          }

          fragmentedMessage = Buffer.concat([fragmentedMessage, frame.payload]);

          if (!frame.fin) {
            continue;
          }

          frame.payload = fragmentedMessage;
          fragmentedMessage = null;
          frame.opcode = 0x1;
        } else if (frame.opcode === 0x1 && !frame.fin) {
          fragmentedMessage = Buffer.from(frame.payload);
          continue;
        }

        if (frame.opcode !== 0x1) {
          continue;
        }

        try {
          const parsed = JSON.parse(frame.payload.toString('utf8')) as Record<string, unknown>;
          const type = String(parsed.type ?? '');

          if (type === 'start') {
            if (session) {
              throw new Error('Audio stream already started for this connection.');
            }

            const mimeType = String(parsed.mimeType ?? 'audio/webm');
            const extension = mimeType.includes('ogg') ? 'ogg' : 'webm';
            const fileName = `stream-${Date.now()}-${randomUUID()}.${extension}`;
            const filePath = join(uploadsDir, fileName);
            const writeStream = createWriteStream(filePath);

            session = {
              filePath,
              fileName,
              mimeType,
              durationMs: 0,
              writeStream,
              chunkCount: 0,
              chunkBytes: 0,
              startedAt: Date.now(),
            };

            console.info('[ws][backend]', streamId, 'stream started', { fileName, mimeType });
            sendWsMessage(socket, { type: 'ack', message: 'stream started' });
            continue;
          }

          if (type === 'chunk' && !session) {
            continue;
          }

          if (type === 'finish' && !session) {
            sendWsMessage(socket, { type: 'ack', message: 'stream already finished' });
            continue;
          }

          if (!session) {
            throw new Error('No active audio stream session.');
          }

          if (type === 'chunk') {
            const chunkBase64 = String(parsed.chunkBase64 ?? '');

            if (!chunkBase64) {
              continue;
            }

            const chunkBuffer = Buffer.from(chunkBase64, 'base64');
            session.chunkCount += 1;
            session.chunkBytes += chunkBuffer.byteLength;
            if (session.chunkCount % 20 === 0) {
              console.info('[ws][backend]', streamId, 'chunk stats', {
                chunkCount: session.chunkCount,
                chunkBytes: session.chunkBytes,
              });
            }
            session.writeStream.write(chunkBuffer);
            continue;
          }

          if (type === 'finish') {
            session.durationMs = Number(parsed.durationMs ?? 0);
            const completedSession = session;
            session = null;

            console.info('[ws][backend]', streamId, 'finish received', {
              durationMs: completedSession.durationMs,
              elapsedMs: Date.now() - completedSession.startedAt,
              chunkCount: completedSession.chunkCount,
              chunkBytes: completedSession.chunkBytes,
            });

            completedSession.writeStream.end(async () => {
              try {
                if (completedSession.durationMs > 2 * 60 * 60 * 1000) {
                  throw new Error('Audio exceeds the maximum duration of 2 hours.');
                }

                console.info('[ws][backend]', streamId, 'processing started', {
                  filePath: completedSession.filePath,
                });
                const result = await meetingService.processAudio({
                  path: completedSession.filePath,
                  originalname: completedSession.fileName,
                  mimetype: completedSession.mimeType,
                });

                console.info('[ws][backend]', streamId, 'processing completed');
                sendWsMessage(socket, { type: 'result', data: result });
              } catch (error) {
                const message =
                  error instanceof Error ? error.message : 'Failed to process audio stream.';
                console.error('[ws][backend]', streamId, 'processing failed', { message });
                sendWsMessage(socket, { type: 'error', error: message });

                if (existsSync(completedSession.filePath)) {
                  unlinkSync(completedSession.filePath);
                }
              }
            });
            continue;
          }

          throw new Error(`Unsupported stream message type: ${type}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Invalid websocket message.';
          console.error('[ws][backend]', streamId, 'invalid websocket message', { message });
          sendWsMessage(socket, { type: 'error', error: message });
        }
      }
    });

    socket.on('error', (error) => {
      console.error('[ws][backend]', streamId, 'socket error', { message: error.message });
      cleanupSession();
      socket.destroy();
    });

    socket.on('close', (hadError) => {
      console.warn('[ws][backend]', streamId, 'socket closed', { hadError });
      cleanupSession();
    });
  });
}

bootstrap();
