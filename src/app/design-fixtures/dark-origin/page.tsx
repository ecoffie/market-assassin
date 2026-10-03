import Link from 'next/link';

/**
 * A page with no PublicShell, so it renders in the root layout's dark theme. The verifier
 * client-navigates from here into the public fixture (no dark frame may appear once public
 * content is present) and back (the dark theme must return).
 */
export default function DarkOriginFixture() {
  return (
    <div style={{ padding: 32 }}>
      <p id="dark-origin">Dark-theme fixture page.</p>
      <Link id="to-public" href="/design-fixtures/public-site">
        Open the public fixture
      </Link>
    </div>
  );
}
