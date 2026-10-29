import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource/lexend/400.css';
import '@nudge/shared/tokens.css';
import '../panel/panel.css';
import { Onboarding } from '../panel/screens/Onboarding';
import { useNudgeStore } from '../panel/store';
import { applyDisplaySettings } from '../lib/a11y';

function Page() {
  const store = useNudgeStore();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (store) applyDisplaySettings(store.settings);
  }, [store]);
  if (!store) return null;
  if (done || store.settings.onboarded)
    return (
      <main className="page narrow stack fade-in">
        <h1>You’re all set.</h1>
        <p className="muted">
          Whenever starting feels hard, press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd> or click the Nudge icon in your toolbar.
        </p>
        <p className="muted small">Tip: pin Nudge with the puzzle-piece menu so it’s always one click away.</p>
        <button type="button" className="btn soft" onClick={() => window.close()}>
          Close this tab
        </button>
      </main>
    );
  return (
    <main className="page narrow">
      <Onboarding settings={store.settings} inTab onDone={() => setDone(true)} />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Page />);
