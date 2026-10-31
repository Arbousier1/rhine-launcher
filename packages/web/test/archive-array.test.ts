import {describe,expect,it} from 'vitest'
import {arrayBounds,arrayLayout} from '../src/motion/archive-array-layout.ts'

describe('archive rack layout', () => {
  it('returns no slots for an empty archive', () => {
    expect(arrayLayout(0)).toEqual([])
  })
  it('centres a single slab on the origin', () => {
    expect(arrayLayout(1)).toEqual([{index:0,col:0,row:0,x:0,z:0}])
  })
  it('splits six slabs into two centred columns of three rows', () => {
    const slots=arrayLayout(6,{rowsPerColumn:4})
    expect(slots.map(s=>s.col)).toEqual([0,0,0,1,1,1])
    expect(slots.map(s=>s.row)).toEqual([0,1,2,0,1,2])
    expect(slots[0].x).toBeCloseTo(-1.45)
    expect(slots[3].x).toBeCloseTo(1.45)
    // Rows are centred front-to-back around z=0.
    expect(slots[0].z).toBeCloseTo(-1.95)
    expect(slots[2].z).toBeCloseTo(1.95)
  })
  it('never exceeds five columns', () => {
    const slots=arrayLayout(40,{rowsPerColumn:1})
    expect(new Set(slots.map(s=>s.col)).size).toBe(5)
  })
  it('reports bounds for camera framing', () => {
    const bounds=arrayBounds(arrayLayout(4,{rowsPerColumn:4}))
    expect(bounds.depth).toBeGreaterThan(bounds.width)
    expect(bounds.radius).toBeGreaterThan(0)
    expect(arrayBounds([]).radius).toBe(3)
  })
})
