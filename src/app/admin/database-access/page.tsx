'use client';

import { useState } from 'react';

export default function AdminDatabaseAccessPage() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [result, setResult] = useState<{ success?: boolean; message?: string; token?: string; link?: string; emailSent?: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [selfAccessLoading, setSelfAccessLoading] = useState(false);

  const handleGrantAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch('/api/admin/grant-database-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, adminPassword }),
      });

      const data = await res.json();

      if (res.ok) {
        setResult({
          success: true,
          message: `Access granted to ${email}`,
          token: data.token,
          link: data.accessLink,
        });
        setEmail('');
        setName('');
      } else {
        setResult({ success: false, message: data.error || 'Failed to grant access' });
      }
    } catch {
      setResult({ success: false, message: 'Something went wrong' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f3f4f6',
      padding: '40px 20px',
      fontFamily: 'Arial, sans-serif',
    }}>
      <div style={{
        maxWidth: '500px',
        margin: '0 auto',
        background: 'white',
        borderRadius: '12px',
        padding: '30px',
        boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
      }}>
        <h1 style={{ color: '#1e3a8a', marginTop: 0 }}>Database Access Admin</h1>

        {/* Quick Owner Access Section */}
        <div style={{
          background: '#fef3c7',
          border: '1px solid #f59e0b',
          borderRadius: '8px',
          padding: '15px',
          marginBottom: '25px',
        }}>
          <h3 style={{ color: '#92400e', marginTop: 0, marginBottom: '10px', fontSize: '16px' }}>
            Quick Owner Access
          </h3>
          <p style={{ color: '#78350f', fontSize: '14px', margin: '0 0 10px 0' }}>
            Access the database directly as admin:
          </p>
          <button
            onClick={async () => {
              setSelfAccessLoading(true);
              try {
                const res = await fetch('/api/admin/grant-database-access', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    email: 'admin@govcongiants.org',
                    name: 'Admin',
                    adminPassword
                  }),
                });
                const data = await res.json();
                if (res.ok && data.accessLink) {
                  window.location.href = data.accessLink;
                } else {
                  alert(data.error || 'Enter admin password first');
                }
              } catch {
                alert('Something went wrong');
              } finally {
                setSelfAccessLoading(false);
              }
            }}
            disabled={selfAccessLoading || !adminPassword}
            style={{
              padding: '10px 20px',
              background: !adminPassword ? '#d1d5db' : selfAccessLoading ? '#9ca3af' : '#f59e0b',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: !adminPassword ? 'not-allowed' : selfAccessLoading ? 'not-allowed' : 'pointer',
              fontWeight: 'bold',
            }}
          >
            {selfAccessLoading ? 'Loading...' : 'Access Database Now'}
          </button>
          {!adminPassword && (
            <p style={{ color: '#92400e', fontSize: '12px', marginTop: '8px', marginBottom: 0 }}>
              Enter admin password below first
            </p>
          )}
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '25px 0' }} />

        <h2 style={{ color: '#374151', fontSize: '18px', marginBottom: '15px' }}>Grant Access to Others</h2>
        <p style={{ color: '#6b7280', marginBottom: '20px', fontSize: '14px' }}>
          Send database access to a customer or partner.
        </p>

        <form onSubmit={handleGrantAccess}>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: '#374151' }}>
              Admin Password
            </label>
            <input
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid #d1d5db',
                fontSize: '16px',
                boxSizing: 'border-box',
              }}
              placeholder="Enter admin password"
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: '#374151' }}>
              Customer Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid #d1d5db',
                fontSize: '16px',
                boxSizing: 'border-box',
              }}
              placeholder="customer@example.com"
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: '#374151' }}>
              Customer Name (optional)
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid #d1d5db',
                fontSize: '16px',
                boxSizing: 'border-box',
              }}
              placeholder="John Doe"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '14px',
              background: loading ? '#9ca3af' : '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: 'bold',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Granting Access...' : 'Grant Access'}
          </button>
        </form>

        {result && (
          <div style={{
            marginTop: '20px',
            padding: '15px',
            borderRadius: '8px',
            background: result.success ? '#f0fdf4' : '#fef2f2',
            border: `1px solid ${result.success ? '#86efac' : '#fca5a5'}`,
          }}>
            <p style={{
              margin: 0,
              color: result.success ? '#166534' : '#dc2626',
              fontWeight: 'bold',
            }}>
              {result.message}
            </p>
            {result.link && (
              <div style={{ marginTop: '10px' }}>
                <p style={{ margin: '0 0 5px 0', color: '#374151', fontSize: '14px' }}>
                  Access Link {result.emailSent ? '(email sent to customer)' : '(send to customer manually)'}:
                </p>
                <input
                  type="text"
                  readOnly
                  value={result.link}
                  style={{
                    width: '100%',
                    padding: '8px',
                    borderRadius: '4px',
                    border: '1px solid #d1d5db',
                    fontSize: '12px',
                    boxSizing: 'border-box',
                  }}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  onClick={() => navigator.clipboard.writeText(result.link || '')}
                  style={{
                    marginTop: '8px',
                    padding: '8px 16px',
                    background: '#10b981',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                  }}
                >
                  Copy Link
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
