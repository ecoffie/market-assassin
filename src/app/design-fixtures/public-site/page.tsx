import Link from 'next/link';
import PublicShell from '@/components/public-site/PublicShell';
import {
  Breadcrumbs,
  Button,
  ButtonLink,
  Card,
  CardGrid,
  Chip,
  CodeBlock,
  Container,
  Dateline,
  Eyebrow,
  Field,
  Heading,
  InlineCode,
  Input,
  Meta,
  Num,
  Panel,
  Prose,
  Rule,
  Section,
  SectionHeader,
  Select,
  Standfirst,
  Stat,
  StatRow,
  Table,
  Textarea,
  TextLink,
} from '@/components/public-site/ui';

/** Every public-site primitive on one page, for the design guard's runtime checks. */
export default function PublicSiteFixture() {
  return (
    <PublicShell>
      <Container>
        <Section>
          <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Fixtures', href: '/design-fixtures/public-site' }, { label: 'Public site' }]} />
          <Dateline>
            <b>Fixture</b> · component inventory
          </Dateline>
          <Heading as="h1" variant="display">
            The public site uses one type system and one palette
          </Heading>
          <Standfirst>
            A standfirst in Libre Baskerville, with a <b>bold figure of 1,234</b> set in the same face.
          </Standfirst>
          <div style={{ display: 'flex', gap: 12, marginTop: 28, flexWrap: 'wrap' }}>
            <ButtonLink href="/pricing">Primary action</ButtonLink>
            <ButtonLink href="/about" variant="secondary">
              Secondary action
            </ButtonLink>
            <Button size="sm">Small button</Button>
            <Link id="to-dark" href="/design-fixtures/dark-origin" className="mp-link">
              Go to the dark fixture
            </Link>
          </div>
        </Section>

        <Section chapter>
          <SectionHeader title="Cards" action={<TextLink href="/contractors">See all</TextLink>} />
          <CardGrid>
            {['First', 'Second', 'Third'].map((t) => (
              <Card key={t} href="/contractors">
                <Eyebrow>Agency name</Eyebrow>
                <Heading as="h3" variant="subtitle" style={{ marginTop: 8 }}>
                  {t} card title
                </Heading>
                <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                  <Chip>Neutral</Chip>
                  <Chip tone="warn">Closes in 3 days</Chip>
                  <Chip tone="ok">Good fit</Chip>
                </div>
              </Card>
            ))}
          </CardGrid>
        </Section>

        <Section chapter>
          <SectionHeader title="Stats" />
          <StatRow>
            <Stat value="4,812" label="Open opportunities" href="/opportunity-hunter" />
            <Stat value="$1.8B" label="Obligated this year" />
            <Stat value="312" label="Recompetes" />
            <Stat value="58" label="Agencies" />
          </StatRow>
        </Section>

        <Section chapter>
          <Eyebrow accent>Editorial kicker</Eyebrow>
          <Prose>
            <h2>A prose heading</h2>
            <p>
              Body copy with a <Link href="/glossary">text link</Link>, an <InlineCode>inline code</InlineCode> token and{' '}
              <strong>strong text</strong>. <Meta>Meta text</Meta> <Num>12,345</Num>
            </p>
            <ul>
              <li>List item one</li>
              <li>List item two</li>
            </ul>
          </Prose>
          <Rule strong />
        </Section>

        <Section chapter>
          <SectionHeader title="Form" />
          <Panel>
            <form style={{ display: 'grid', gap: 16, maxWidth: 480 }}>
              <Field label="Company name" htmlFor="fx-name" help="As registered in SAM.gov">
                <Input id="fx-name" placeholder="Acme Federal" />
              </Field>
              <Field label="Set-aside" htmlFor="fx-sa">
                <Select id="fx-sa" defaultValue="8a">
                  <option value="8a">8(a)</option>
                  <option value="hubzone">HUBZone</option>
                </Select>
              </Field>
              <Field label="Notes" htmlFor="fx-notes">
                <Textarea id="fx-notes" />
              </Field>
              <div>
                <Button type="submit">Submit</Button>
              </div>
            </form>
          </Panel>
        </Section>

        <Section chapter>
          <SectionHeader title="Table and code" />
          <Table>
            <thead>
              <tr>
                <th>Contractor</th>
                <th>Awards</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Example Corp</td>
                <td className="mp-num">$12.4M</td>
              </tr>
              <tr>
                <td>Sample LLC</td>
                <td className="mp-num">$3.1M</td>
              </tr>
            </tbody>
          </Table>
          <div style={{ marginTop: 20 }}>
            <CodeBlock>{'curl https://mcp.getmindy.ai/mcp'}</CodeBlock>
          </div>
        </Section>
      </Container>
    </PublicShell>
  );
}
