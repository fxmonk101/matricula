const fs = require('fs');
const p = 'src/app/(app)/people/add-person.tsx';
const orig = fs.readFileSync(p, 'utf8');
const crlf = orig.includes('\r\n');
let s = orig.replace(/\r\n/g, '\n');

const pairs = [
  // --- state: track first/last so a username can be suggested from them ---
  [
`  const [email, setEmail] = useState('');`,
`  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');`,
  ],
  [
`  const emailLooksWrong = email.trim().length > 0 && !isValidEmail(email);`,
`  const emailLooksWrong = email.trim().length > 0 && !isValidEmail(email);
  const usernameProblem = username.trim() ? usernameRejectionReason(username) : null;

  // What the server will generate if the registrar supplies neither. Shown so
  // the account's identifier is never a surprise discovered at handover.
  const suggestion = suggestUsername(firstName, lastName);
  const willGenerate = !email.trim() && !username.trim() && suggestion;
  const noIdentifier = !email.trim() && !username.trim() && !suggestion;`,
  ],

  // --- the name fields feed the suggestion ---
  [
`                <Field label="First name" htmlFor="firstName" required>
                  <Input id="firstName" name="firstName" required autoComplete="off" />
                </Field>
                <Field label="Last name" htmlFor="lastName" required>
                  <Input id="lastName" name="lastName" required autoComplete="off" />
                </Field>`,
`                <Field label="First name" htmlFor="firstName" required>
                  <Input
                    id="firstName"
                    name="firstName"
                    required
                    autoComplete="off"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                </Field>
                <Field label="Last name" htmlFor="lastName" required>
                  <Input
                    id="lastName"
                    name="lastName"
                    required
                    autoComplete="off"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </Field>`,
  ],

  // --- email is no longer required; username sits beside it ---
  [
`          <Field
            label="Email"
            htmlFor="email"
            required
            error={emailLooksWrong ? 'That does not look like an email address.' : undefined}
            hint="If they already have an account here, they keep their existing password."
          >
            <Input
              id="email"
              name="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
            />
          </Field>`,
`          {/*
            NEITHER is required on its own, but one of them must be present.
            A university enrolling an intake has names and no mailboxes, so
            demanding an address here is what makes a registry invent them.
          */}
          <Field
            label="Email"
            htmlFor="email"
            error={emailLooksWrong ? 'That does not look like an email address.' : undefined}
            hint="Optional. If they already have an account here, they keep their existing password."
          >
            <Input
              id="email"
              name="email"
              type="text"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          </Field>

          <Field
            label="Username"
            htmlFor="username"
            error={usernameProblem ?? undefined}
            hint={
              willGenerate
                ? \`Leave blank and they will be given "\${suggestion}".\`
                : 'Optional. What they type to sign in, if they have no email address.'
            }
          >
            <Input
              id="username"
              name="username"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              placeholder={suggestion || 'a.okafor'}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          </Field>

          {noIdentifier && (
            <Alert tone="warning">
              Enter an email address or a username. Without one, this person has no way to sign in.
            </Alert>
          )}`,
  ],
];

for (const [from, to] of pairs) {
  if (!s.includes(from)) { console.error('NOT FOUND:\n' + from); process.exit(1); }
  s = s.replace(from, to);
}

s = s.replace(
  "import { isValidEmail } from '@/lib/domain/people';",
  "import {\n  isValidEmail,\n  suggestUsername,\n  usernameRejectionReason,\n} from '@/lib/domain/identifier';",
);

fs.writeFileSync(p, crlf ? s.replace(/\n/g, '\r\n') : s);
console.log('add-person updated');
