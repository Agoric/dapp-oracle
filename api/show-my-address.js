import { E } from '@endo/far';

export const showMyAddress = async homeP => {
  const addr = await E(E.get(homeP).myAddressNameAdmin).getMyAddress();
  console.log(`ORACLE_ADDRESS=${addr}`);
};

export default showMyAddress;
