import { useEffect, useState } from 'react';
import { startWaku, getNode } from '@pichat/network';
import { logger } from '../utils/logger';

export const useWakuNode = () => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const start = async () => {
      try {
        await startWaku();
        setReady(true);
      } catch (err) {
        logger.error('Failed to start Waku node', err);
      }
    };
    if (!getNode()) {
      start();
    } else {
      setReady(true);
    }
  }, []);

  return { ready };
};
