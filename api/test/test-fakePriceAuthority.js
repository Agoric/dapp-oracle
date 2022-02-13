// @ts-check

import '@agoric/zoe/tools/prepare-test-env.js';
// eslint-disable-next-line import/no-extraneous-dependencies
import test from 'ava';
import { E } from '@agoric/far';
import buildManualTimer from '@agoric/zoe/tools/manualTimer.js';

// import { makeFakePriceAuthority } from '@agoric/zoe/tools/fakePriceAuthority';
import { makeFakePriceAuthority } from '../priceAuthority/src/fake.js';
import { setup } from './setupBasicMints.js';

/**
 * @param {Object} param0
 * @param {Map<string, Brand>} param0.brands
 * @param {Array<bigint>} [param0.priceList]
 * @param {Array<[bigint, bigint]>} [param0.tradeList]
 * @param {TimerService} param0.timer
 */
const makeTestPriceAuthority = ({ brands, priceList, tradeList, timer }) =>
  makeFakePriceAuthority({
    brandIn: brands.get('moola'),
    brandOut: brands.get('bucks'),
    priceList,
    tradeList,
    timer,
  });

test('priceAuthority quoteAtTime', async t => {
  const { moola, bucks, brands } = setup();
  const bucksBrand = brands.get('bucks');
  const manualTimer = buildManualTimer(console.log, 0n);
  const priceAuthority = await makeTestPriceAuthority({
    brands,
    priceList: [20n, 55n],
    timer: manualTimer,
  });

  const done = E(priceAuthority)
    .quoteAtTime(3n, moola(5n), bucksBrand)
    .then(async quote => {
      t.deepEqual(
        moola(5n),
        quote.quoteAmount.value[0].amountIn,
        'amountIn match',
      );
      t.deepEqual(bucks(55n * 5n), quote.quoteAmount.value[0].amountOut);
      t.is(3n, quote.quoteAmount.value[0].timestamp);
    });

  await E(manualTimer).tick();
  await E(manualTimer).tick();
  await E(manualTimer).tick();
  await E(manualTimer).tick();
  await done;
});

test('priceAuthority quoteGiven', async t => {
  const { moola, brands, bucks } = setup();
  const bucksBrand = brands.get('bucks');
  const manualTimer = buildManualTimer(console.log, 0n);
  const priceAuthority = await makeTestPriceAuthority({
    brands,
    priceList: [20n, 55n],
    timer: manualTimer,
  });

  await E(manualTimer).tick();
  const quote = await E(priceAuthority).quoteGiven(moola(37n), bucksBrand);
  const quoteAmount = quote.quoteAmount.value[0];
  t.is(1n, quoteAmount.timestamp);
  t.deepEqual(bucks(37n * 20n), quoteAmount.amountOut);
});

test('priceAuthority quoteWanted', async t => {
  const { moola, bucks, brands } = setup();
  const moolaBrand = brands.get('moola');
  const manualTimer = buildManualTimer(console.log, 0n);
  const priceAuthority = await makeTestPriceAuthority({
    brands,
    priceList: [20n, 55n],
    timer: manualTimer,
  });

  await E(manualTimer).tick();
  const quote = await E(priceAuthority).quoteWanted(moolaBrand, bucks(400n));
  const quoteAmount = quote.quoteAmount.value[0];
  t.is(1n, quoteAmount.timestamp);
  t.deepEqual(bucks(400n), quoteAmount.amountOut);
  t.deepEqual(moola(20n), quoteAmount.amountIn);
});

test('priceAuthority paired quotes', async t => {
  const { moola, bucks, brands } = setup();
  const moolaBrand = brands.get('moola');
  const bucksBrand = brands.get('bucks');
  const manualTimer = buildManualTimer(console.log, 0n);
  const priceAuthority = await makeTestPriceAuthority({
    brands,
    tradeList: [
      [2n, 40n],
      [1n, 55n],
    ],
    timer: manualTimer,
  });

  await E(manualTimer).tick();

  const quoteOut = await E(priceAuthority).quoteWanted(moolaBrand, bucks(400n));
  const quoteOutAmount = quoteOut.quoteAmount.value[0];
  t.is(1n, quoteOutAmount.timestamp);
  t.deepEqual(bucks((20n * 40n) / 2n), quoteOutAmount.amountOut);
  t.deepEqual(moola(20n), quoteOutAmount.amountIn);

  const quoteIn = await E(priceAuthority).quoteGiven(moola(22n), bucksBrand);
  const quoteInAmount = quoteIn.quoteAmount.value[0];
  t.is(1n, quoteInAmount.timestamp);
  t.deepEqual(bucks(20n * 22n), quoteInAmount.amountOut);
  t.deepEqual(moola(22n), quoteInAmount.amountIn);
});

test('priceAuthority quoteWhenGTE', async t => {
  const { moola, bucks, brands } = setup();
  const manualTimer = buildManualTimer(console.log, 0n);
  const priceAuthority = await makeTestPriceAuthority({
    brands,
    priceList: [20n, 30n, 25n, 40n],
    timer: manualTimer,
  });

  const expected = E(priceAuthority)
    .quoteWhenGTE(moola(1n), bucks(40n))
    .then(quote => {
      const quoteInAmount = quote.quoteAmount.value[0];
      t.is(4n, manualTimer.getCurrentTimestamp());
      t.is(4n, quoteInAmount.timestamp);
      t.deepEqual(bucks(40n), quoteInAmount.amountOut);
      t.deepEqual(moola(1n), quoteInAmount.amountIn);
    });

  await E(manualTimer).tick();
  await E(manualTimer).tick();
  await E(manualTimer).tick();
  await E(manualTimer).tick();
  await expected;
});

test('priceAuthority quoteWhenLT', async t => {
  const { moola, bucks, brands } = setup();
  const manualTimer = buildManualTimer(console.log, 0n);
  const priceAuthority = await makeTestPriceAuthority({
    brands,
    priceList: [40n, 30n, 29n],
    timer: manualTimer,
  });

  const expected = E(priceAuthority)
    .quoteWhenLT(moola(1n), bucks(30n))
    .then(quote => {
      const quoteInAmount = quote.quoteAmount.value[0];
      t.is(3n, manualTimer.getCurrentTimestamp());
      t.is(3n, quoteInAmount.timestamp);
      t.deepEqual(bucks(29n), quoteInAmount.amountOut);
      t.deepEqual(moola(1n), quoteInAmount.amountIn);
    });

  await E(manualTimer).tick();
  await E(manualTimer).tick();
  await E(manualTimer).tick();
  await expected;
});

test('priceAuthority quoteWhenGT', async t => {
  const { moola, bucks, brands } = setup();
  const manualTimer = buildManualTimer(console.log, 0n);
  const priceAuthority = await makeTestPriceAuthority({
    brands,
    priceList: [40n, 30n, 41n],
    timer: manualTimer,
  });

  const expected = E(priceAuthority)
    .quoteWhenGT(moola(1n), bucks(40n))
    .then(quote => {
      const quoteInAmount = quote.quoteAmount.value[0];
      t.is(3n, manualTimer.getCurrentTimestamp());
      t.is(3n, quoteInAmount.timestamp);
      t.deepEqual(bucks(41n), quoteInAmount.amountOut);
      t.deepEqual(moola(1n), quoteInAmount.amountIn);
    });

  await E(manualTimer).tick();
  await E(manualTimer).tick();
  await E(manualTimer).tick();
  await expected;
});

test('priceAuthority quoteWhenLTE', async t => {
  const { moola, bucks, brands } = setup();
  const manualTimer = buildManualTimer(console.log, 0n);
  const priceAuthority = await makeTestPriceAuthority({
    brands,
    priceList: [40n, 26n, 50n, 25n],
    timer: manualTimer,
  });

  const expected = E(priceAuthority)
    .quoteWhenLTE(moola(1n), bucks(25n))
    .then(quote => {
      const quoteInAmount = quote.quoteAmount.value[0];
      t.is(4n, quoteInAmount.timestamp);
      t.is(4n, manualTimer.getCurrentTimestamp());
      t.deepEqual(bucks(25n), quoteInAmount.amountOut);
      t.deepEqual(moola(1n), quoteInAmount.amountIn);
    });

  await E(manualTimer).tick();
  await E(manualTimer).tick();
  await E(manualTimer).tick();
  await E(manualTimer).tick();
  await expected;
});
