export const dynamic = 'force-dynamic';

export default function NotFound() {
  return (
    <div style={{
      padding: '40px',
      textAlign: 'center',
      fontFamily: 'system-ui, sans-serif'
    }}>
      <h2 style={{ color: '#1f2937', marginBottom: '16px' }}>
        Page Not Found
      </h2>
      <p style={{ color: '#6b7280', marginBottom: '24px' }}>
        The page you are looking for does not exist.
      </p>
      <a
        href="/"
        style={{
          backgroundColor: '#2563eb',
          color: 'white',
          padding: '12px 24px',
          border: 'none',
          borderRadius: '8px',
          textDecoration: 'none',
          fontSize: '16px'
        }}
      >
        Go Home
      </a>
    </div>
  );
}
