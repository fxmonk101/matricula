'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, Field, Input } from '@/components/ui';
import { slugify } from '@/lib/domain/provisioning';

/**
 * "Go to your institution."
 *
 * This REPLACED a list of every school on the platform. That list was a public
 * customer register — anyone could read off which universities had bought the
 * product — and it broke the thing each school is paying for, which is that
 * their portal is theirs and does not advertise anybody else's.
 *
 * Typing an address and being sent to it leaks nothing the address itself does
 * not already leak: the page you land on is the same page you would reach by
 * typing the URL. That is the same trade Slack and SharePoint make.
 */
export function FindSchool() {
  const router = useRouter();
  const [value, setValue] = useState('');

  const slug = slugify(value.trim());

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!slug) return;
        // Navigate rather than validate. Asking the server "does this school
        // exist?" before navigating would turn this box into an enumeration
        // oracle that answers faster than loading the page does.
        router.push(`/s/${slug}/login`);
      }}
      className="space-y-3"
    >
      <Field
        label="Your institution's address"
        htmlFor="school-address"
        hint={slug ? `You will be taken to /s/${slug}` : 'The address your institution gave you.'}
      >
        <Input
          id="school-address"
          name="school"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="golden-eagles"
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <Button type="submit" variant="secondary" className="w-full" disabled={!slug}>
        Continue
      </Button>
    </form>
  );
}
