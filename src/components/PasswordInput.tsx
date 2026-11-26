import { useState, type InputHTMLAttributes } from 'react';
import { Icon } from './Icon';

/** A password box with an eye button that shows or hides what was typed. */
export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-wrap">
      <input {...props} type={show ? 'text' : 'password'} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      <button type="button" className="pw-eye" onClick={() => setShow(!show)}
        aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show} title={show ? 'Hide password' : 'Show password'}>
        <Icon name={show ? 'eyeOff' : 'eye'} />
      </button>
    </div>
  );
}
