/**
 * Send messages via WeChat iLink API.
 */

import crypto from "node:crypto";
import { getUploadUrl, sendMessage } from "./api.js";
import { uploadToCdn } from "./media.js";
import { MessageType, MessageState, UploadMediaType, MessageItemType } from "./types.js";

export interface WeixinSendOpts {
  baseUrl: string;
  token?: string;
  contextToken?: string;
}

export interface WeixinMediaSendOpts extends WeixinSendOpts {
  cdnBaseUrl: string;
}

export async function sendTextMessage(
  to: string,
  text: string,
  opts: WeixinSendOpts,
): Promise<string> {
  if (!opts.contextToken) {
    throw new Error("contextToken is required to send a message");
  }

  const clientId = `wechat-acp-${crypto.randomUUID()}`;
  await sendMessage({
    baseUrl: opts.baseUrl,
    token: opts.token,
    body: {
      msg: {
        from_user_id: "",
        to_user_id: to,
        client_id: clientId,
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        context_token: opts.contextToken,
        item_list: [{ type: 1, text_item: { text } }],
      },
    },
  });
  return clientId;
}

export async function sendImageMessage(
  to: string,
  imageBuffer: Buffer,
  opts: WeixinMediaSendOpts,
): Promise<string> {
  if (!opts.contextToken) {
    throw new Error("contextToken is required to send an image");
  }

  const aesKey = crypto.randomBytes(16);
  const aesKeyBase64 = aesKey.toString("base64");
  const filekey = `wechat-acp-img-${crypto.randomUUID()}`;
  const rawSize = imageBuffer.length;
  const rawMd5 = crypto.createHash("md5").update(imageBuffer).digest("hex");
  const encryptedSize = rawSize + (16 - (rawSize % 16));

  const uploadResp = await getUploadUrl({
    baseUrl: opts.baseUrl,
    token: opts.token,
    body: {
      filekey,
      media_type: UploadMediaType.IMAGE,
      to_user_id: to,
      rawsize: rawSize,
      rawfilemd5: rawMd5,
      filesize: encryptedSize,
      aeskey: aesKeyBase64,
      no_need_thumb: true,
    },
  });

  if (!uploadResp.upload_param) {
    throw new Error("getUploadUrl returned no upload_param for image");
  }

  const downloadParam = await uploadToCdn({
    buffer: imageBuffer,
    uploadParam: uploadResp.upload_param,
    aesKey,
    filekey,
    cdnBaseUrl: opts.cdnBaseUrl,
  });

  const clientId = `wechat-acp-${crypto.randomUUID()}`;
  await sendMessage({
    baseUrl: opts.baseUrl,
    token: opts.token,
    body: {
      msg: {
        from_user_id: "",
        to_user_id: to,
        client_id: clientId,
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        context_token: opts.contextToken,
        item_list: [{
          type: MessageItemType.IMAGE,
          image_item: {
            media: {
              encrypt_query_param: downloadParam,
              aes_key: aesKeyBase64,
            },
            mid_size: rawSize,
          },
        }],
      },
    },
  });
  return clientId;
}

export async function sendFileMessage(
  to: string,
  fileBuffer: Buffer,
  fileName: string,
  opts: WeixinMediaSendOpts,
): Promise<string> {
  if (!opts.contextToken) {
    throw new Error("contextToken is required to send a file");
  }

  const aesKey = crypto.randomBytes(16);
  const aesKeyBase64 = aesKey.toString("base64");
  const filekey = `wechat-acp-file-${crypto.randomUUID()}`;
  const rawSize = fileBuffer.length;
  const rawMd5 = crypto.createHash("md5").update(fileBuffer).digest("hex");
  const encryptedSize = rawSize + (16 - (rawSize % 16));

  const uploadResp = await getUploadUrl({
    baseUrl: opts.baseUrl,
    token: opts.token,
    body: {
      filekey,
      media_type: UploadMediaType.FILE,
      to_user_id: to,
      rawsize: rawSize,
      rawfilemd5: rawMd5,
      filesize: encryptedSize,
      aeskey: aesKeyBase64,
      no_need_thumb: true,
    },
  });

  if (!uploadResp.upload_param) {
    throw new Error("getUploadUrl returned no upload_param for file");
  }

  const downloadParam = await uploadToCdn({
    buffer: fileBuffer,
    uploadParam: uploadResp.upload_param,
    aesKey,
    filekey,
    cdnBaseUrl: opts.cdnBaseUrl,
  });

  const clientId = `wechat-acp-${crypto.randomUUID()}`;
  await sendMessage({
    baseUrl: opts.baseUrl,
    token: opts.token,
    body: {
      msg: {
        from_user_id: "",
        to_user_id: to,
        client_id: clientId,
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        context_token: opts.contextToken,
        item_list: [{
          type: MessageItemType.FILE,
          file_item: {
            media: {
              encrypt_query_param: downloadParam,
              aes_key: aesKeyBase64,
            },
            file_name: fileName,
            len: String(rawSize),
            md5: rawMd5,
          },
        }],
      },
    },
  });
  return clientId;
}

export async function sendVideoMessage(
  to: string,
  videoBuffer: Buffer,
  opts: WeixinMediaSendOpts,
): Promise<string> {
  if (!opts.contextToken) {
    throw new Error("contextToken is required to send a video");
  }

  const aesKey = crypto.randomBytes(16);
  const aesKeyBase64 = aesKey.toString("base64");
  const filekey = `wechat-acp-vid-${crypto.randomUUID()}`;
  const rawSize = videoBuffer.length;
  const rawMd5 = crypto.createHash("md5").update(videoBuffer).digest("hex");
  const encryptedSize = rawSize + (16 - (rawSize % 16));

  const uploadResp = await getUploadUrl({
    baseUrl: opts.baseUrl,
    token: opts.token,
    body: {
      filekey,
      media_type: UploadMediaType.VIDEO,
      to_user_id: to,
      rawsize: rawSize,
      rawfilemd5: rawMd5,
      filesize: encryptedSize,
      aeskey: aesKeyBase64,
      no_need_thumb: true,
    },
  });

  if (!uploadResp.upload_param) {
    throw new Error("getUploadUrl returned no upload_param for video");
  }

  const downloadParam = await uploadToCdn({
    buffer: videoBuffer,
    uploadParam: uploadResp.upload_param,
    aesKey,
    filekey,
    cdnBaseUrl: opts.cdnBaseUrl,
  });

  const clientId = `wechat-acp-${crypto.randomUUID()}`;
  await sendMessage({
    baseUrl: opts.baseUrl,
    token: opts.token,
    body: {
      msg: {
        from_user_id: "",
        to_user_id: to,
        client_id: clientId,
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        context_token: opts.contextToken,
        item_list: [{
          type: MessageItemType.VIDEO,
          video_item: {
            media: {
              encrypt_query_param: downloadParam,
              aes_key: aesKeyBase64,
            },
            video_size: rawSize,
            video_md5: rawMd5,
          },
        }],
      },
    },
  });
  return clientId;
}

/**
 * Split text into segments of max length, respecting line breaks where possible.
 */
export function splitText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const segments: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      segments.push(remaining);
      break;
    }

    // Try to break at a newline
    let breakAt = remaining.lastIndexOf("\n", maxLen);
    if (breakAt <= 0) breakAt = maxLen;

    segments.push(remaining.substring(0, breakAt));
    remaining = remaining.substring(breakAt).replace(/^\n/, "");
  }

  return segments;
}
