import { isIPhoneOrIPad } from './IosSaveTip';

/** How to install the journal as an app on Windows, Mac, iPhone, iPad and Android. */
const isApple = () => /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
const isAndroid = () => /Android/.test(navigator.userAgent);

type Guide = { title: string; steps: React.ReactNode[]; other?: React.ReactNode; after: string };

const GUIDES: Record<'windows' | 'mac' | 'iphone' | 'android', Guide> = {
  windows: {
    title: 'Windows',
    steps: [
      <>Open the journal in <strong>Edge</strong> or <strong>Chrome</strong>.</>,
      <>Click the <strong>Install app</strong> icon at the right end of the address bar (a small screen with a down arrow).</>,
      <>Click <strong>Install</strong>.</>,
    ],
    other: <>No icon? In Edge: ⋯ → Apps → Install this site as an app. In Chrome: ⋮ → Cast, save and share → Install page as app.</>,
    after: 'It opens from the Start menu in its own window. You can pin it to the taskbar.',
  },
  mac: {
    title: 'Mac',
    steps: [
      <>Open the journal in <strong>Safari</strong>.</>,
      <>Choose <strong>File → Add to Dock</strong>.</>,
      <>Click <strong>Add</strong>.</>,
    ],
    other: <>Using Chrome or Edge? Click the install icon at the right end of the address bar.</>,
    after: 'It opens from the Dock or Launchpad in its own window.',
  },
  iphone: {
    title: 'iPhone and iPad',
    steps: [
      <>Open the journal in <strong>Safari</strong>.</>,
      <>Tap the <strong>Share</strong> button (the square with an arrow).</>,
      <>Tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</>,
    ],
    after: 'It opens from its icon on the Home Screen like any other app.',
  },
  android: {
    title: 'Android',
    steps: [
      <>Open the journal in <strong>Chrome</strong>.</>,
      <>Tap <strong>⋮</strong> (top right).</>,
      <>Tap <strong>Add to Home screen</strong> (or <strong>Install app</strong>), then <strong>Install</strong>.</>,
    ],
    after: 'It opens from its icon like any other app.',
  },
};

export function InstallSteps() {
  const order: (keyof typeof GUIDES)[] = isAndroid() ? ['android', 'windows', 'mac', 'iphone']
    : isIPhoneOrIPad() ? ['iphone', 'mac', 'windows', 'android']
    : isApple() ? ['mac', 'iphone', 'windows', 'android']
    : ['windows', 'mac', 'iphone', 'android'];
  return (
    <div className="install-guides">
      {order.map((k) => {
        const g = GUIDES[k];
        return (
          <div key={k} className="install-guide">
            <h4>{g.title}</h4>
            <ol>{g.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            <p className="muted small">{g.after}</p>
            {g.other && <p className="muted small">{g.other}</p>}
          </div>
        );
      })}
    </div>
  );
}

export function InstallCard() {
  return (
    <section className="card pad">
      <h3>Install</h3>
      <p className="muted">Install the journal so it opens like a normal app and works offline. Sign in with the same account on each device to see your journals everywhere.</p>
      <InstallSteps />
    </section>
  );
}
