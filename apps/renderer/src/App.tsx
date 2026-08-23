import { useCallback, useEffect, useState } from 'react';

interface RuntimeHellApi {
  ping: (sentAt: number) => Promise<{ pong: true; receivedAt: number; echoSentAt?: number }>;
}

declare global {
  interface Window {
    api: RuntimeHellApi;
  }
}

export function App(): React.JSX.Element {
  const [pingResult, setPingResult] = useState<string>('pinging…');

  const doPing = useCallback(async () => {
    try {
      const res = await window.api.ping(Date.now());
      setPingResult(`pong (round-trip ${res.receivedAt - (res.echoSentAt ?? res.receivedAt)}ms)`);
    } catch (err) {
      setPingResult(`ping failed: ${String(err)}`);
    }
  }, []);

  useEffect(() => {
    void doPing();
  }, [doPing]);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>RuntimeHell</h1>
      <p>IPC bridge status: {pingResult}</p>
      <button onClick={() => void doPing()}>Ping main process</button>
    </div>
  );
}
