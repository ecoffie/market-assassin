/**
 * Weird Awards — curated curious terms + read/shape helpers for the /weird Discover feed.
 *
 * The curation is the ONLY editorial part: we pick which unmistakably-odd purchase
 * descriptions to look for. Every RESULT is a real USASpending award (real amount, real
 * award_id → /awards/[id] proof). Grounded, never fabricated.
 */
import { getReadClient } from '@/lib/supabase/server-clients';

/**
 * Curious purchase terms → the human "hook" shown on the card. Deliberately specific
 * phrases (not bare words) so matches are genuinely odd, not mundane false positives.
 * The government really does buy these — usually for MWR / family-day / ceremony events.
 */
export const WEIRD_TERMS: Array<{ like: string; hook: string; emoji: string }> = [
  { like: 'PETTING ZOO', hook: 'a petting zoo', emoji: '🐐' },
  { like: 'BOUNCE HOUSE', hook: 'a bounce house', emoji: '🏰' },
  { like: 'MOON BOUNCE', hook: 'a moon bounce', emoji: '🌙' },
  { like: 'DUNK TANK', hook: 'a dunk tank', emoji: '💦' },
  { like: 'MECHANICAL BULL', hook: 'a mechanical bull', emoji: '🐂' },
  { like: 'COTTON CANDY', hook: 'cotton candy', emoji: '🍬' },
  { like: 'SNOW CONE', hook: 'snow cones', emoji: '🍧' },
  { like: 'FACE PAINTING', hook: 'face painting', emoji: '🎨' },
  { like: 'BALLOON ARTIST', hook: 'a balloon artist', emoji: '🎈' },
  { like: 'BAGPIPE', hook: 'bagpipes', emoji: '🎶' },
  { like: 'MAGICIAN', hook: 'a magician', emoji: '🎩' },
  { like: 'CLOWN', hook: 'a clown', emoji: '🤡' },
  { like: 'PONY RIDE', hook: 'pony rides', emoji: '🐴' },
  { like: 'MARIACHI', hook: 'a mariachi band', emoji: '🎺' },
  { like: 'KARAOKE', hook: 'karaoke', emoji: '🎤' },
  { like: 'PINATA', hook: 'piñatas', emoji: '🪅' },
  { like: 'CARICATURE', hook: 'a caricature artist', emoji: '✏️' },
  { like: 'MASCOT', hook: 'a mascot costume', emoji: '🦅' },
  { like: 'ESCAPE ROOM', hook: 'an escape room', emoji: '🔓' },
  { like: 'HYPNOTIST', hook: 'a hypnotist', emoji: '🌀' },
  { like: 'CAMEL RIDE', hook: 'camel rides', emoji: '🐫' },
  { like: 'CLIMBING WALL', hook: 'a climbing wall', emoji: '🧗' },
  { like: 'FUNNEL CAKE', hook: 'funnel cake', emoji: '🍰' },
  { like: 'POPCORN MACHINE', hook: 'a popcorn machine', emoji: '🍿' },
  { like: 'KETTLE CORN', hook: 'kettle corn', emoji: '🌽' },
  { like: 'FERRIS WHEEL', hook: 'a Ferris wheel', emoji: '🎡' },
  { like: 'CARNIVAL', hook: 'a carnival', emoji: '🎪' },
  { like: 'STILT WALKER', hook: 'a stilt walker', emoji: '🤸' },
  { like: 'JUGGLER', hook: 'a juggler', emoji: '🤹' },
  { like: 'FORTUNE TELLER', hook: 'a fortune teller', emoji: '🔮' },
  { like: 'SANTA CLAUS', hook: 'Santa Claus', emoji: '🎅' },
  { like: 'EASTER BUNNY', hook: 'the Easter Bunny', emoji: '🐰' },
  { like: 'LASER TAG', hook: 'laser tag', emoji: '🎯' },
  { like: 'ZIP LINE', hook: 'a zip line', emoji: '🛷' },
  { like: 'SUMO SUIT', hook: 'sumo suits', emoji: '🤼' },
  { like: 'PHOTO BOOTH', hook: 'a photo booth', emoji: '📸' },
  { like: 'BUBBLE MACHINE', hook: 'a bubble machine', emoji: '🫧' },
  { like: 'HOT DOG CART', hook: 'a hot dog cart', emoji: '🌭' },
  { like: 'PETTING FARM', hook: 'a petting farm', emoji: '🐑' },
  { like: 'INFLATABLE SLIDE', hook: 'an inflatable slide', emoji: '🎢' },
];

export interface WeirdAward {
  award_id: string;
  piid: string | null;
  recipient_name: string | null;
  awarding_agency: string | null;
  obligation_amount: number;
  description: string | null;
  category: string | null;
  action_date: string | null;
  recipient_state: string | null;
}

/** Read the feed for the page — biggest, most shareable first. */
export async function getWeirdAwards(limit = 40): Promise<WeirdAward[]> {
  const { data, error } = await getReadClient()
    .from('weird_awards')
    .select('award_id, piid, recipient_name, awarding_agency, obligation_amount, description, category, action_date, recipient_state')
    .order('obligation_amount', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getWeirdAwards: ${error.message}`);
  return (data ?? []) as WeirdAward[];
}
