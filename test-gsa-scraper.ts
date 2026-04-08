import { testGSAScraper } from './src/lib/forecasts/scrapers/gsa-acquisition-gateway';

testGSAScraper().then(() => {
  console.log('\nTest complete!');
  process.exit(0);
}).catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});
