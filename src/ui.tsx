import { useEffect, useRef, type ReactNode } from 'react';
import { X, Check, LoaderCircle, ArrowUpRight } from 'lucide-react';

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={`logo ${small ? 'small' : ''}`}>
      <span className="logo-mark">
        <span />
        <span />
        <span />
      </span>
      <span>
        fun bench<span className="logo-dot">.</span>
      </span>
    </span>
  );
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="关闭弹窗" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function Loading({ text = '正在准备…' }: { text?: string }) {
  return (
    <div className="loading">
      <LoaderCircle className="spin" size={22} />
      <span>{text}</span>
    </div>
  );
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [message, onClose]);
  return (
    <div className="toast" role="status">
      <Check size={17} />
      {message}
      <button className="icon-button" aria-label="关闭提示" onClick={onClose}>
        <X size={15} />
      </button>
    </div>
  );
}
export function MysteryArt() {
  return (
    <div className="mystery-art" aria-hidden="true">
      <div className="orbit orbit-one" />
      <div className="orbit orbit-two" />
      <span className="art-spark spark-one">✳</span>
      <span className="art-spark spark-two">✦</span>
      <div className="art-sticker">
        NO LABELS.
        <br />
        JUST GOOD ANSWERS.
        <ArrowUpRight size={14} />
      </div>
      <div className="mystery-card card-back">
        <span className="card-tag">神秘选手 B</span>
        <div className="character character-b">
          <div className="eyes">
            <i />
            <i />
          </div>
          <div className="mouth" />
        </div>
        <span className="card-bottom">
          实力，藏不住。<span>✧</span>
        </span>
      </div>
      <div className="mystery-card card-front">
        <span className="card-tag">
          神秘选手 A <span>?</span>
        </span>
        <div className="character character-a">
          <div className="eyes">
            <i />
            <i />
          </div>
          <div className="mouth" />
        </div>
        <span className="card-bottom">
          先看答案，再看名字。<span>✧</span>
        </span>
      </div>
      <div className="art-ticket">
        <span className="ticket-star">★</span>
        <div>
          你的判断，才是标准。<small>THE JUDGE IS YOU</small>
        </div>
      </div>
    </div>
  );
}
