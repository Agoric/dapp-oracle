// @ts-check
import { E } from '@endo/far';
import { ZipReader } from '@endo/zip';
import { encodeBase64, decodeBase64 } from '@endo/base64';

const config = {
  maxBytesInFlight: 800_000,
};

export const installInPieces = async (bundle, tool) => {
  const bundler = E(tool).makeBundler();

  const { endoZipBase64, ...shell } = bundle;
  const zip = new ZipReader(decodeBase64(endoZipBase64));

  let approxBytesInFlight = 0;
  let inFlightTransactions = [];
  for await (const [name, entry] of zip.files.entries()) {
    if (approxBytesInFlight >= config.maxBytesInFlight) {
      await Promise.all(inFlightTransactions);
      approxBytesInFlight = 0;
      inFlightTransactions = [];
    }

    console.log('adding', name, entry.content.length, '...');
    const encodedContent = encodeBase64(entry.content);
    approxBytesInFlight += name.length + encodedContent.length;
    inFlightTransactions.push(E(bundler).add(name, encodedContent));
  }
  await Promise.all(inFlightTransactions);

  console.log('installing...');
  const installation = await E(bundler)
    .install(shell)
    .finally(() => E(bundler).clear());
  // console.log({ installation });
  return installation;
};

export const zoeInstall = async (
  { BUNDLER_MAKER_LOOKUP, contractPath },
  { board, zoe, scratch, lookup, bundleSource, pathResolve },
) => {
  // Locate the bundler maker if any.
  let bundlerMaker = await E(scratch).get('bundlerMaker');
  if (BUNDLER_MAKER_LOOKUP) {
    const p = JSON.parse(BUNDLER_MAKER_LOOKUP);
    if (p[0] === 'entrypoint') {
      const file = p[1];
      console.log('Bundling bundle maker', file);
      const bundle = await bundleSource(pathResolve(file));
      console.log('Instantiating bundle maker...');
      const { publicFacet } = await E(zoe).startInstance(
        E(zoe).install(bundle),
      );
      bundlerMaker = publicFacet;
      await E(scratch).set('bundlerMaker', bundlerMaker);
    } else {
      bundlerMaker = await lookup(p);
    }
    const bundlerMakerId = await E(board).getId(bundlerMaker);
    console.log(
      `-- BUNDLER_MAKER_LOOKUP='${JSON.stringify(['board', bundlerMakerId])}'`,
    );
  }

  // Bundle the contract in question.
  console.log('Bundling contract', contractPath);
  const bundle = await bundleSource(pathResolve(contractPath));
  if (bundlerMaker) {
    console.log('Installing contract with bundler maker');
    return installInPieces(bundle, bundlerMaker);
  }
  console.log('Installing contract without bundler maker');
  return E(zoe).install(bundle);
};
