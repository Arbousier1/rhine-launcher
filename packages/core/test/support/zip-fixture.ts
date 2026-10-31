import {crc32} from 'node:zlib'
/** Small standards-compliant stored ZIP writer used only for transaction fixtures. */
export function fixtureZip(files:Record<string,string|Buffer>):Buffer{
 const local:Buffer[]=[],central:Buffer[]=[];let offset=0
 for(const [name,value]of Object.entries(files)){
  const filename=Buffer.from(name),data=Buffer.isBuffer(value)?value:Buffer.from(value),crc=crc32(data)>>>0
  const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(filename.length,26)
  const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(0x800,8);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(data.length,20);directory.writeUInt32LE(data.length,24);directory.writeUInt16LE(filename.length,28);directory.writeUInt32LE(offset,42)
  local.push(header,filename,data);central.push(directory,filename);offset+=header.length+filename.length+data.length
 }
 const end=Buffer.alloc(22),table=Buffer.concat(central);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(table.length,12);end.writeUInt32LE(offset,16)
 return Buffer.concat([...local,table,end])
}
