import {describe,it,expect} from 'vitest'
import {errorResponse} from '../src/plugin-http.ts'
describe('original advanced error hints',()=>{
 it('preserves safe original exception type/reason but not raw token/command data',async()=>{
  const error=Object.assign(new Error('Device login cancelled'),{name:'UserException',code:'FLOW_CANCELLED',status:409,exception:{type:'userAcquireMicrosoftTokenFailed',reason:'USER_CANCELED',accessToken:'secret',rawBody:{refreshToken:'secret'},command:['--accessToken','secret']}})
  const response=errorResponse(error),body=await response.json()
  expect(response.status).toBe(409)
  expect(body).toMatchObject({name:'UserException',origin:'runtime-service',exception:{type:'userAcquireMicrosoftTokenFailed',reason:'USER_CANCELED'}})
  expect(JSON.stringify(body)).not.toContain('secret');expect(body.exception.command).toBeUndefined()
 })
 it('keeps ordinary API error shapes unchanged',async()=>{expect(await errorResponse(Object.assign(new Error('Missing'),{code:'NOT_FOUND',status:404})).json()).toEqual({code:'NOT_FOUND',message:'Missing'})})
})
