import dns from 'dns';
import { Address4, Address6 } from 'ip-address';
import { assert, details } from '@agoric/assert';

// Subnets taken from https://en.wikipedia.org/wiki/Private_network
const IPV4_PRIVATE_SUBNETS = [
  '127.0.0.0/8', // loopback
  '10.0.0.0/8', // private
  '172.16.0.0/12', // private
  '192.168.0.0/16', // private
  '169.254.0.0/16', // link-local
];

const IPV6_PRIVATE_SUBNETS = [
  'fc00::/7', // unicast local address
  'fd00::/8', // private subnet
];

export const assertIPv4IsPublic = address => {
  // Assert
  const a4 = new Address4(address);
  assert(a4.isCorrect(), details`Address ${address} is incorrect`);
  assert(!a4.isMulticast(), details`Address ${address} is multicast`);
  for (const subnet of IPV4_PRIVATE_SUBNETS) {
    assert(
      !a4.isInSubnet(new Address4(subnet)),
      details`Address ${address} is in private subnet ${subnet}`,
    );
  }
};

export const assertIPv6IsPublic = address => {
  const a6 = new Address6(address);
  assert(a6.isCorrect(), details`Address ${address} is incorrect`);
  assert(!a6.isLoopback(), details`Address ${address} is loopback`);
  assert(!a6.isLinkLocal(), details`Address ${address} is link-local`);
  assert(!a6.isMulticast(), details`Address ${address} is multicast`);

  for (const subnet of IPV4_PRIVATE_SUBNETS) {
    assert(
      !a6.isInSubnet(new Address4(subnet)),
      details`Address ${address} is in private subnet ${subnet}`,
    );
  }
  for (const subnet of IPV6_PRIVATE_SUBNETS) {
    assert(
      !a6.isInSubnet(new Address6(subnet)),
      details`Address ${address} is in private subnet ${subnet}`,
    );
  }
};

export const assertHostnameIsPublic = async hostname => {
  const { address, family } = await new Promise((resolve, reject) => {
    // Look up the hostname.
    dns.lookup(hostname, (err, addr, fam) => {
      if (err) {
        reject(err);
        return;
      }
      resolve({ address: addr, family: fam });
    });
  });

  if (family === 4) {
    return assertIPv4IsPublic(address);
  }
  return assertIPv6IsPublic(address);
};

export const assertUrlIsPublic = async urlstr => {
  const url = new URL(urlstr);
  return assertHostnameIsPublic(url.hostname);
};
