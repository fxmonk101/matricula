'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import * as ToastPrimitive from '@radix-ui/react-toast';

import { cn } from '@/lib/utils';
import { Button } from './index';

/**
 * =============================================================================
 * OVERLAY PRIMITIVES
 * =============================================================================
 *
 * Dialogs, menus and toasts, built on Radix.
 *
 * WHY A DEPENDENCY HERE AND NOWHERE ELSE
 * --------------------------------------
 * Everything else in this design system is hand-written, because a button and a
 * card are twenty lines and a dependency for them is a liability. Overlays are
 * the exception: getting one right means focus trapping, focus restoration,
 * Escape and outside-click dismissal, `aria-modal` and labelling, scroll
 * locking, portalling out of clipping ancestors, typeahead in menus, roving
 * tabindex, and screen-reader live regions. Each of those is a well-known bug
 * class, and hand-rolling them produces a component that looks right and is
 * unusable with a keyboard.
 *
 * What is NOT adopted is the styling: these wear this project's own tokens, so
 * the contrast pipeline in `scripts/check-contrast.cjs` still governs every
 * colour on screen.
 */

// -----------------------------------------------------------------------------
// Dialog — a form or a detail view, over the page
// -----------------------------------------------------------------------------

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const overlayClasses =
  'fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[2px] ' +
  'data-[state=open]:animate-in data-[state=closed]:animate-out ' +
  'data-[state=open]:fade-in data-[state=closed]:fade-out';

const panelClasses =
  'fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 ' +
  'rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10 focus:outline-none';

export function DialogContent({
  title,
  description,
  children,
  footer,
  className,
  wide,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlayClasses} />
      <DialogPrimitive.Content className={cn(panelClasses, wide && 'max-w-3xl', className)}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-200/70 px-6 py-4">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-base font-semibold tracking-tight text-slate-900">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-0.5 text-xs leading-relaxed text-slate-500">
                {description}
              </DialogPrimitive.Description>
            ) : (
              // Radix warns when a dialog has no description. An explicitly
              // empty one is honest; a hidden lorem string is not.
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            aria-label="Close"
            className="-mr-1 -mt-1 shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
              <path d="M5.3 4.3a1 1 0 0 1 1.4 0L10 7.6l3.3-3.3a1 1 0 1 1 1.4 1.4L11.4 9l3.3 3.3a1 1 0 0 1-1.4 1.4L10 10.4l-3.3 3.3a1 1 0 0 1-1.4-1.4L8.6 9 5.3 5.7a1 1 0 0 1 0-1.4Z" />
            </svg>
          </DialogPrimitive.Close>
        </div>

        {/* Capped and scrollable: a form with twelve fields must not push its
            own submit button off the bottom of the viewport. */}
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>

        {footer ? (
          <div className="flex justify-end gap-2 border-t border-slate-200/70 bg-slate-50/60 px-6 py-3.5">
            {footer}
          </div>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

// -----------------------------------------------------------------------------
// Confirm — replaces window.confirm
// -----------------------------------------------------------------------------

/**
 * A styled confirmation.
 *
 * `window.confirm` blocks the main thread, cannot be styled, is suppressible by
 * the browser, and on some platforms renders a dialog that says the page's
 * origin rather than what is about to happen. It was standing in for this.
 *
 * The confirm button carries the VERB — "Suspend", not "OK" — because a person
 * who has stopped reading still reads the button.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
  destructive,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  destructive?: boolean;
}) {
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className={overlayClasses} />
        <AlertDialogPrimitive.Content className={cn(panelClasses, 'max-w-md p-6')}>
          <AlertDialogPrimitive.Title className="text-base font-semibold tracking-tight text-slate-900">
            {title}
          </AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description asChild>
            <div className="mt-2 text-sm leading-relaxed text-slate-600">{body}</div>
          </AlertDialogPrimitive.Description>
          <div className="mt-6 flex justify-end gap-2">
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="secondary" size="sm">
                Cancel
              </Button>
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action asChild>
              <Button variant={destructive ? 'danger' : 'primary'} size="sm" onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

// -----------------------------------------------------------------------------
// Dropdown menu — row actions
// -----------------------------------------------------------------------------

export const Menu = DropdownPrimitive.Root;
export const MenuTrigger = DropdownPrimitive.Trigger;

export function MenuButton({ label = 'Actions' }: { label?: string }) {
  return (
    <DropdownPrimitive.Trigger
      aria-label={label}
      className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 data-[state=open]:bg-slate-100 data-[state=open]:text-slate-900"
    >
      {label}
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3" aria-hidden>
        <path d="M5.5 7.5 10 12l4.5-4.5Z" />
      </svg>
    </DropdownPrimitive.Trigger>
  );
}

export function MenuContent({ children }: { children: React.ReactNode }) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        align="end"
        sideOffset={4}
        // Portalled, so it escapes the table cell's overflow rather than being
        // clipped by it — which is why the previous inline version had to
        // expand the row instead of floating above it.
        className="z-50 min-w-[11rem] rounded-xl border border-slate-200 bg-white p-1 shadow-lg shadow-slate-900/5"
      >
        {children}
      </DropdownPrimitive.Content>
    </DropdownPrimitive.Portal>
  );
}

export function MenuItem({
  children,
  onSelect,
  destructive,
  disabled,
}: {
  children: React.ReactNode;
  onSelect?: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <DropdownPrimitive.Item
      disabled={disabled}
      onSelect={(event) => {
        // Radix closes on select. A menu item that opens a dialog must let the
        // close finish first, or focus restoration fights the dialog for it.
        event.preventDefault();
        onSelect?.();
      }}
      className={cn(
        'flex cursor-pointer select-none items-center rounded-lg px-2.5 py-1.5 text-xs outline-none transition',
        'data-[highlighted]:bg-slate-100',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
        destructive ? 'text-rose-700 data-[highlighted]:bg-rose-50' : 'text-slate-700',
      )}
    >
      {children}
    </DropdownPrimitive.Item>
  );
}

export function MenuSeparator() {
  return <DropdownPrimitive.Separator className="my-1 h-px bg-slate-100" />;
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <DropdownPrimitive.Label className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
      {children}
    </DropdownPrimitive.Label>
  );
}

// -----------------------------------------------------------------------------
// Toasts
// -----------------------------------------------------------------------------

type ToastTone = 'success' | 'danger' | 'info';
interface ToastMessage {
  id: number;
  title: string;
  body?: string;
  tone: ToastTone;
}

const ToastContext = React.createContext<{
  push: (message: Omit<ToastMessage, 'id'>) => void;
} | null>(null);

/**
 * Tell the user what happened.
 *
 * Results used to render as a line of text beside the control that produced
 * them, which is missed exactly when it matters — after a destructive action,
 * when the eye has already moved on. A toast is announced to assistive
 * technology as well, via Radix's live region.
 */
export function useToast() {
  const ctx = React.useContext(ToastContext);
  // Deliberately a no-op rather than a throw outside the provider: a missing
  // toast is a missing convenience, and taking a page down over it would be a
  // worse outcome than the one it is reporting.
  return ctx ?? { push: () => {} };
}

const TONE_STYLES: Record<ToastTone, { ring: string; dot: string }> = {
  success: { ring: 'ring-emerald-200', dot: 'bg-emerald-500' },
  danger: { ring: 'ring-rose-200', dot: 'bg-rose-500' },
  info: { ring: 'ring-slate-200', dot: 'bg-slate-400' },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = React.useState<ToastMessage[]>([]);
  const nextId = React.useRef(0);

  const push = React.useCallback((message: Omit<ToastMessage, 'id'>) => {
    nextId.current += 1;
    const id = nextId.current;
    setMessages((current) => [...current, { ...message, id }]);
  }, []);

  const value = React.useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="right" duration={6000}>
        {children}
        {messages.map((message) => {
          const tone = TONE_STYLES[message.tone];
          return (
            <ToastPrimitive.Root
              key={message.id}
              onOpenChange={(open) => {
                if (!open) setMessages((c) => c.filter((m) => m.id !== message.id));
              }}
              className={cn(
                'flex items-start gap-3 rounded-xl bg-white px-4 py-3 shadow-lg shadow-slate-900/10 ring-1',
                tone.ring,
                'data-[state=open]:animate-in data-[state=open]:slide-in-from-right',
                'data-[state=closed]:animate-out data-[state=closed]:fade-out',
              )}
            >
              <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', tone.dot)} aria-hidden />
              <div className="min-w-0 flex-1">
                <ToastPrimitive.Title className="text-xs font-semibold text-slate-900">
                  {message.title}
                </ToastPrimitive.Title>
                {message.body ? (
                  <ToastPrimitive.Description className="mt-0.5 text-[11px] leading-relaxed text-slate-600">
                    {message.body}
                  </ToastPrimitive.Description>
                ) : null}
              </div>
              <ToastPrimitive.Close
                aria-label="Dismiss"
                className="-mr-1 -mt-0.5 shrink-0 rounded p-1 text-slate-400 hover:text-slate-700"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
                  <path d="M5.3 4.3a1 1 0 0 1 1.4 0L10 7.6l3.3-3.3a1 1 0 1 1 1.4 1.4L11.4 9l3.3 3.3a1 1 0 0 1-1.4 1.4L10 10.4l-3.3 3.3a1 1 0 0 1-1.4-1.4L8.6 9 5.3 5.7a1 1 0 0 1 0-1.4Z" />
                </svg>
              </ToastPrimitive.Close>
            </ToastPrimitive.Root>
          );
        })}
        <ToastPrimitive.Viewport className="no-print fixed bottom-0 right-0 z-[60] flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-2 p-4 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}
