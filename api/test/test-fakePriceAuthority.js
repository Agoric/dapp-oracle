// @ts-check

import '@agoric/zoe/tools/prepare-test-env';
// eslint-disable-next-line import/no-extraneous-dependencies
import test from 'ava';
import { E } from '@agoric/eventual-send';
import buildManualTimer from '@agoric/zoe/tools/manualTimer';

// import { makeFakePriceAuthority } from '@agoric/zoe/tools/fakePriceAuthority';
import { makeFakePriceAuthority } from '../src/priceAuthority/fake';
import { setup } from './setupBasicMints';

/**
 * @param {Object} param0
 * @param {Map<string, AmountMath>} param0.amountMaths
 * @param {Array<number>} [param0.priceList]
 * @param {Array<[number, number]>} [param0.tradeList]
 * @param {TimerService} param0.timer
 */
const makeTestPriceAuthority = ({ amountMaths, priceList, tradeList, timer }) =>
  makeFakePriceAuthority({
    mathIn: amountMaths.get('moola'),
    mathOut: amountMaths.get('bucks'),
    priceList,
    tradeList,
    timer,
  });

test('priceAuthority quoteAtTime', async t => {
  const { moola, bucks, amountMaths, brands } = setup();
  const bucksBrand = brands.get('bucks');
  const manualTimer = buildManualTimer(console.log, 0n);
  const priceAuthority = await makeTestPriceAuthority({
    amountMaths,
    priceList: [20, 55],
    timer: manualTimer,
  });

  const done = E(priceAuthority)
    .quoteAtTime(3n, moola(5), bucksBrand)
    .then(async quote => {
      t.deepEqual(
        moola(5),
        quote.quoteAmount.value[0].amountIn,
        'amountIn match',
      );
      t.deepEqual(bucks(55 * 5), quote.quoteAmount.value[0].amountOut);
      t.is(3n, quote.quoteAmount.value[0].timestamp);
    });

  await E(manualTimer).tick();
  await E(manualTimer).tick();
  await E(manualTimer).tick();
  await E(manualTimer).tick();
  await done;
});

test('priceAuthority quoteGiven', async t => {
  const { moola, amountMaths, brands, bucks } = setup();
  const bucksBrand = brands.get('bucks');
  const manualTimer = buildManualTimer(console.log, 0n);
  const priceAuthority = await makeTestPriceAuthority({
    amountMaths,
    priceList: [20, 55],
    timer: manualTimer,
  });

  await E(manualTimer).tick();
  const quote = await E(priceAuthority).quoteGiven(moola(37), bucksBrand);
  const quoteAmount = quote.quoteAmount.value[0];
  t.is(1n, quoteAmount.timestamp);
  t.deepEqual(bucks(37 * 20), quoteAmount.amountOut);
});

test('priceAuthority quoteWanted', async t => {
  const { moola, bucks, amountMaths, brands } = setup();
  const moolaBrand = brands.get('moola');
  const manualTimer = buildManualTimer(console.log, 0n);
  const priceAuthority = await makeTestPriceAuthority({
    amountMaths,
    priceList: [20, 55],
    timer: manualTimer,
  });

  await E(manualTimer).tick();
  const quote = await E(priceAuthority).quoteWanted(moolaBrand, bucks(400));
  const quoteAmount = quote.quoteAmount.value[0];
  t.is(1n, quoteAmount.timestamp);
  t.deepEqual(bucks(400), quoteAmount.amountOut);
  t.deepEqual(moola(20), quoteAmount.amountIn);
});

test('priceAuthority paired quotes', async t => {
  const { moola, bucks, amountMaths, brands } = setup();
  const moolaBrand = brands.get('moola');
  const bucksBrand = brands.get('bucks');
  const manualTimer = buildManualTimer(console.log, 0n);
  const priceAuthority = await makeTestPriceAuthority({
    amountMaths,
    tradeList: [
      [2, 40],
      [1, 55],
    ],
    timer: manualTimer,
  });

  await E(manualTimer).tick();

  const quoteOut = await E(priceAuthority).quoteWanted(moolaBrand, bucks(400));
  const quoteOutAmount = quoteOut.quoteAmount.value[0];
  t.is(1n, quoteOutAmount.timestamp);
  t.deepEqual(bucks((20 * 40) / 2), quoteOutAmount.amountOut);
  t.deepEqual(moola(20), quoteOutAmount.amountIn);

  const quoteIn = await E(priceAuthority).quoteGiven(moola(22), bucksBrand);
  const quoteInAmount = quoteIn.quoteAmount.value[0];
  t.is(1n, quoteInAmount.timestamp);
  t.deepEqual(bucks(20 * 22), quoteInAmount.amountOut);
  t.deepEqual(moola(22), quoteInAmount.amountIn);
});

test('priceAuthority quoteWhenGTE', async t => {
  const { moola, bucks, amountMaths } = setup();
  const manualTimer = buildManualTimer(console.log, 0n);
  const priceAuthority = await makeTestPriceAuthority({
    amountMaths,
    priceList: [20, 30, 25, 40],
    timer: manualTimer,
  });

  const expected = E(priceAuthority)
    .quoteWhenGTE(moola(1), bucks(40))
    .then(quote => {
      const quoteInAmount = quote.quoteAmount.value[0];
      t.is(4n, manualTimer.getCurrentTimestamp());
      t.is(4n, quoteInAmount.timestamp);
      t.deepEqual(bucks(40), quoteInAmount.amountOut);
      t.deepEqual(moola(1), quoteInAmount.amountIn);
    });

  await E(manualTimer).tick();
  await E(manualTimer).tick();
  await E(manualTimer).tick();
  await E(manualTimer).tick();
  await expected;
});

test('priceAuthority quoteWhenLT', async t => {
  const { moola, bucks, amountMaths } = setup();
  const manualTimer = buildManualTimer(console.log, 0n);
  const priceAuthority = await makeTestPriceAuthority({
    amountMaths,
    priceList: [40, 30, 29],
    timer: manualTimer,
  });

  const expected = E(priceAuthority)
    .quoteWhenLT(moola(1), bucks(30))
    .then(quote => {
      const quoteInAmount = quote.quoteAmount.value[0];
      t.is(3n, manualTimer.getCurrentTimestamp());
      t.is(3n, quoteInAmount.timestamp);
      t.deepEqual(bucks(29), quoteInAmount.amountOut);
      t.deepEqual(moola(1), quoteInAmount.amountIn);
    });

  await E(manualTimer).tick();
  await E(manualTimer).tick();
  await E(manualTimer).tick();
  await expected;
});

test('priceAuthority quoteWhenGT', async t => {
  const { moola, bucks, amountMaths } = setup();
  const manualTimer = buildManualTimer(console.log, 0n);
  const priceAuthority = await makeTestPriceAuthority({
    amountMaths,
    priceList: [40, 30, 41],
    timer: manualTimer,
  });

  const expected = E(priceAuthority)
    .quoteWhenGT(moola(1), bucks(40))
    .then(quote => {
      const quoteInAmount = quote.quoteAmount.value[0];
      t.is(3n, manualTimer.getCurrentTimestamp());
      t.is(3n, quoteInAmount.timestamp);
      t.deepEqual(bucks(41), quoteInAmount.amountOut);
      t.deepEqual(moola(1), quoteInAmount.amountIn);
    });

  await E(manualTimer).tick();
  await E(manualTimer).tick();
  await E(manualTimer).tick();
  await expected;
});

test('priceAuthority quoteWhenLTE', async t => {
  const { moola, bucks, amountMaths } = setup();
  const manualTimer = buildManualTimer(console.log, 0n);
  const priceAuthority = await makeTestPriceAuthority({
    amountMaths,
    priceList: [40, 26, 50, 25],
    timer: manualTimer,
  });

  const expected = E(priceAuthority)
    .quoteWhenLTE(moola(1), bucks(25))
    .then(quote => {
      const quoteInAmount = quote.quoteAmount.value[0];
      t.is(4n, quoteInAmount.timestamp);
      t.is(4n, manualTimer.getCurrentTimestamp());
      t.deepEqual(bucks(25), quoteInAmount.amountOut);
      t.deepEqual(moola(1), quoteInAmount.amountIn);
    });

  await E(manualTimer).tick();
  await E(manualTimer).tick();
  await E(manualTimer).tick();
  await E(manualTimer).tick();
  await expected;
});
