/** How to install the journal as an app on Windows, Mac, iPhone and iPad. */
const isApple = () => /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
const isPhone = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Mac') && navigator.maxTouchPoints > 1);

const STEPS = {
  windows: {
    title: 'Windows',
    text: <>In Edge or Chrome, click the install icon at the right end of the address bar (or ⋯ → Apps → Install this site as an app). The journal then opens in its own window from the Start menu.</>,
  },
  mac: {
    title: 'Mac',
    text: <>In Safari, choose <strong>File → Add to Dock</strong>. In Chrome or Edge, click the install icon at the right end of the address bar. The journal then opens from the Dock or Launchpad in its own window.</>,
  },
  iphone: {
    title: 'iPhone and iPad',
    text: <>Open the journal in Safari, tap the <strong>Share</strong> button (the square with an arrow), then <strong>Add to Home Screen</strong> and <strong>Add</strong>. It then opens from its icon like any other app.</>,
  },
};

export function InstallSteps() {
  const order: (keyof typeof STEPS)[] = isPhone() ? ['iphone', 'mac', 'windows'] : isApple() ? ['mac', 'iphone', 'windows'] : ['windows', 'mac', 'iphone'];
  return (
    <ul className="plain">
      {order.map((k) => <li key={k}><strong>{STEPS[k].title}:</strong> {STEPS[k].text}</li>)}
    </ul>
  );
}

export function InstallCard() {
  return (
    <section className="card pad">
      <h3>Install the app</h3>
      <p className="muted">Install the journal so it opens in its own window and works offline. Each computer or phone keeps its own copy; sign in with the same account on each one to see the same journals everywhere.</p>
      <InstallSteps />
    </section>
  );
}
