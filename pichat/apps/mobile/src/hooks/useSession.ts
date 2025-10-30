import { useEffect, useState } from 'react';
import { initializeIdentity } from '../services/cryptoClient';
import { useIdentityStore } from '../state/identity';
import { logger } from '../utils/logger';

export const useSession = () => {
  const identity = useIdentityStore((state) => state.identity);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        await initializeIdentity();
      } catch (err) {
        logger.error('Failed to initialize identity', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return { identity, loading };
};
