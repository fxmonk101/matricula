import { redirect } from 'next/navigation';

/**
 * `/admin` is a guard prefix, not a destination.
 *
 * It exists in ROUTE_GUARDS to protect everything beneath it, but had no page —
 * so an administrator who trimmed the URL, or followed a stale link, got a 404
 * from a path the route table says they are entitled to. Sending them to the
 * one page that lives under it is better than a dead end.
 */
export default function AdminIndexPage() {
  redirect('/admin/audit');
}
