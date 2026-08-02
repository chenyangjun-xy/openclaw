// Matrix plugin module owns portable presentation encoding for room events.
import {
  adaptMessagePresentationForChannel,
  hasMessagePresentationBlocks,
  normalizeMessagePresentation,
  renderMessagePresentationFallbackText,
  type MessagePresentation,
} from "openclaw/plugin-sdk/interactive-runtime";
import type { ReplyPayload } from "openclaw/plugin-sdk/reply-runtime";
import { isRecord } from "../record-shared.js";
import type { MatrixExtraContentFields } from "./send/types.js";

const MATRIX_OPENCLAW_PRESENTATION_KEY = "com.openclaw.presentation" as const;
const MATRIX_OPENCLAW_PRESENTATION_TYPE = "message.presentation" as const;
const MATRIX_EMPTY_PRESENTATION_FALLBACK_TEXT = "---";

/** Declared once so inbound rendering adapts controls exactly like outbound. */
export const MATRIX_PRESENTATION_CAPABILITIES = {
  supported: true,
  buttons: true,
  selects: true,
  context: true,
  divider: true,
  limits: {
    text: {
      markdownDialect: "markdown",
      supportsEdit: true,
    },
  },
} as const;

type MatrixChannelData = {
  extraContent?: MatrixExtraContentFields;
};

function resolveMatrixChannelData(payload: ReplyPayload): MatrixChannelData {
  const channelData = isRecord(payload.channelData) ? payload.channelData : undefined;
  const matrix = isRecord(channelData) ? channelData.matrix : undefined;
  return (isRecord(matrix) ? (matrix as MatrixChannelData) : undefined) ?? {};
}

function buildMatrixPresentationContent(presentation: MessagePresentation) {
  return {
    ...presentation,
    version: 1,
    type: MATRIX_OPENCLAW_PRESENTATION_TYPE,
  };
}

function resolveMatrixPresentationContent(
  payload: ReplyPayload,
): Record<string, unknown> | undefined {
  const extraContent = resolveMatrixChannelData(payload).extraContent;
  const rawPresentation = isRecord(extraContent)
    ? extraContent[MATRIX_OPENCLAW_PRESENTATION_KEY]
    : undefined;
  const presentation = isRecord(rawPresentation) ? rawPresentation : undefined;
  if (
    !presentation ||
    presentation.version !== 1 ||
    presentation.type !== MATRIX_OPENCLAW_PRESENTATION_TYPE
  ) {
    return undefined;
  }
  return presentation;
}

/** Encodes a portable presentation into the room-event field Matrix clients read. */
export function renderMatrixPresentationPayload(params: {
  payload: ReplyPayload;
  presentation: MessagePresentation;
}): ReplyPayload {
  const matrixData = resolveMatrixChannelData(params.payload);
  const fallbackText = renderMessagePresentationFallbackText({
    text: params.payload.text,
    presentation: params.presentation,
    emptyFallback: MATRIX_EMPTY_PRESENTATION_FALLBACK_TEXT,
  });
  return {
    ...params.payload,
    text: fallbackText,
    channelData: {
      ...params.payload.channelData,
      matrix: {
        ...matrixData,
        extraContent: {
          [MATRIX_OPENCLAW_PRESENTATION_KEY]: buildMatrixPresentationContent(params.presentation),
        },
      },
    },
  };
}

/**
 * Applies the presentation encoding the outbound adapter would have applied.
 * Inbound monitor delivery bypasses the core `renderPresentation` hook, so
 * without this the encoded field never exists and buttons/selects are dropped.
 */
export function applyMatrixPresentationPayload(payload: ReplyPayload): ReplyPayload {
  if (resolveMatrixPresentationContent(payload)) {
    return payload;
  }
  const presentation = normalizeMessagePresentation(payload.presentation);
  if (!presentation || !hasMessagePresentationBlocks(presentation)) {
    return payload;
  }
  const adapted = adaptMessagePresentationForChannel({
    presentation,
    capabilities: MATRIX_PRESENTATION_CAPABILITIES,
  });
  // Mirrors renderPresentationForDelivery: authored fallback text is replaced by
  // the rendered one, and the portable fields never reach the transport.
  const textIsFallback = payload.presentationTextMode === "fallback";
  const {
    presentation: _presentation,
    presentationTextMode: _presentationTextMode,
    ...rest
  } = renderMatrixPresentationPayload({
    payload: { ...payload, ...(textIsFallback ? { text: undefined } : {}) },
    presentation: adapted,
  });
  return rest;
}

export function resolveMatrixPayloadText(payload: ReplyPayload): string {
  const text = payload.text ?? "";
  if (text.trim() || !resolveMatrixPresentationContent(payload)) {
    return text;
  }
  return MATRIX_EMPTY_PRESENTATION_FALLBACK_TEXT;
}

export function resolveMatrixExtraContent(
  payload: ReplyPayload,
): MatrixExtraContentFields | undefined {
  const presentation = resolveMatrixPresentationContent(payload);
  return presentation ? { [MATRIX_OPENCLAW_PRESENTATION_KEY]: presentation } : undefined;
}
