import Link from 'next/link';

export const metadata = {
  title: 'Access Required | Federal Contractor Database',
  description: 'Purchase access to the Federal Contractor Database',
};

export default function DatabaseLockedPage() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%)',
      fontFamily: 'Arial, sans-serif',
      padding: '20px',
    }}>
      <div style={{
        background: 'white',
        borderRadius: '16px',
        padding: '40px',
        maxWidth: '500px',
        textAlign: 'center',
        boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
      }}>
        <div style={{ fontSize: '48px', marginBottom: '20px' }}>🔒</div>
        <h1 style={{ color: '#1e3a8a', marginBottom: '10px', fontSize: '28px' }}>
          Federal Contractor Database
        </h1>
        <p style={{ color: '#6b7280', marginBottom: '30px', fontSize: '16px', lineHeight: '1.6' }}>
          Access to this database requires a purchase. Get lifetime access to 3,500+ federal prime contractors with SBLO contacts and supplier portals.
        </p>

        <div style={{
          background: '#f0fdf4',
          border: '1px solid #86efac',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '30px',
          textAlign: 'left',
        }}>
          <h3 style={{ color: '#166534', marginTop: 0, marginBottom: '12px' }}>What&apos;s Included:</h3>
          <ul style={{ color: '#15803d', margin: 0, paddingLeft: '20px', lineHeight: '1.8' }}>
            <li><strong>3,500+</strong> federal prime contractors</li>
            <li><strong>$430B+</strong> in contract data</li>
            <li><strong>800+</strong> SBLO contacts with emails</li>
            <li><strong>115+</strong> supplier portal links</li>
            <li>Export to CSV for outreach</li>
            <li>Lifetime access</li>
          </ul>
        </div>

        <a
          href="https://buy.stripe.com/4gMaEY3wqcjo6h70CsfnO0g"
          style={{
            display: 'inline-block',
            background: '#2563eb',
            color: 'white',
            padding: '16px 32px',
            borderRadius: '8px',
            textDecoration: 'none',
            fontWeight: 'bold',
            fontSize: '18px',
            marginBottom: '15px',
          }}
        >
          Get Access Now
        </a>

        <p style={{ color: '#9ca3af', fontSize: '14px', marginTop: '20px' }}>
          Already purchased?{' '}
          <Link href="/" style={{ color: '#2563eb' }}>
            Check your email for access link
          </Link>
        </p>
      </div>
    </div>
  );
}
