import os from 'node:os';

interface LanAddress {
  readonly ip: string;
  readonly name: string;
}

/**
 * LAN から到達可能な IPv4 アドレス候補を列挙する。
 * - 内部/仮想 NIC を含めた候補を返すため、用途に応じて絞り込みが必要
 */
export const listLanIpv4Addresses = (): LanAddress[] => {
  const interfaces = os.networkInterfaces();
  const results: LanAddress[] = [];

  for (const [name, infos] of Object.entries(interfaces)) {
    if (!infos) {
      continue;
    }

    for (const info of infos) {
      if (info.family !== 'IPv4' || info.internal) {
        continue;
      }

      results.push({ ip: info.address, name });
    }
  }

  return results;
};
