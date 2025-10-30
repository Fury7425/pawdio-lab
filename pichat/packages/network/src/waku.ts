import {
  createLightNode,
  waitForRemotePeer,
  createEncoder,
  createDecoder,
  type LightNode,
} from 'js-waku';
import type { EncryptedEnvelope } from '@pichat/types';
import { createLogger } from '@pichat/utils';

const logger = createLogger('network:waku');
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

let node: LightNode | undefined;

export const getNode = () => node;

export async function startWaku(): Promise<void> {
  if (node) {
    return;
  }
  node = await createLightNode({ defaultBootstrap: true });
  await node.start();
  await waitForRemotePeer(node);
  logger.info('Waku node started');
}

export async function publish(topic: string, env: EncryptedEnvelope): Promise<void> {
  if (!node) {
    await startWaku();
  }
  if (!node) {
    throw new Error('Waku node not available');
  }
  const encoder = createEncoder({ contentTopic: topic });
  const payload = textEncoder.encode(JSON.stringify(env));
  await node.relay.send(encoder, { payload });
  logger.debug('Published envelope', topic);
}

export async function subscribe(
  topic: string,
  onEnvelope: (env: EncryptedEnvelope) => void,
): Promise<() => void> {
  if (!node) {
    await startWaku();
  }
  if (!node) {
    throw new Error('Waku node not available');
  }
  const decoder = createDecoder(topic);
  const handler = (wakuMessage: { payload?: Uint8Array }) => {
    if (!wakuMessage.payload) {
      return;
    }
    try {
      const env = JSON.parse(textDecoder.decode(wakuMessage.payload)) as EncryptedEnvelope;
      onEnvelope(env);
    } catch (err) {
      logger.error('Failed to decode envelope', err);
    }
  };

  await node.relay.subscribe([decoder], handler);
  logger.info('Subscribed to topic', topic);

  return () => {
    node?.relay.unsubscribe([decoder], handler).catch((err: unknown) => {
      logger.warn('Failed to unsubscribe', err);
    });
  };
}
