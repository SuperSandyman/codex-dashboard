import { useEffect, useRef, useState } from 'react';

interface CommandBarProps {
  readonly onSend: (value: string) => void;
  readonly disabled: boolean;
}

/**
 * モバイル向けのコマンド入力バー。
 * @param props CommandBar プロパティ
 */
export const CommandBar = ({ onSend, disabled }: CommandBarProps) => {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!disabled) {
      inputRef.current?.focus();
    }
  }, [disabled]);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    onSend(`${trimmed}\n`);
    setValue('');
  };

  return (
    <div className="command-bar">
      <input
        ref={inputRef}
        className="command-input"
        placeholder="Type a command and send..."
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            handleSend();
          }
        }}
        disabled={disabled}
      />
      <button className="button button-primary" type="button" onClick={handleSend} disabled={disabled}>
        Send
      </button>
      <span className="command-hint">Mobile quick input</span>
    </div>
  );
};
