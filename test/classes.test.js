import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { dependencyFindings } from '../src/domain/classes/layerRules.js'
import { solidFindings } from '../src/domain/classes/solidRules.js'
import { layerOf } from '../src/domain/project/layers.js'

// End to end over the fixture repo with planted violations (test/fixtures/solid_py).
const folders = ['shop/domain', 'shop/application', 'shop/adapters', 'shop/infrastructure']
const layers = { domain: ['shop/domain'], application: ['shop/application'], adapters: ['shop/adapters'], infrastructure: ['shop/infrastructure'] }
const model = JSON.parse(
  execFileSync(process.env.CODEFLOW_PYTHON || 'python3', ['-I', 'src/infrastructure/extract_py.py', 'classes', '--root', 'test/fixtures/solid_py', '--folders', folders.join(',')], { encoding: 'utf8' }),
)
for (const c of model.classes) c.layer = layerOf(layers, c.folder)
const findings = [...dependencyFindings(model, layers), ...solidFindings(model, { layers })]
const has = (rule, re) => findings.some((f) => f.rule === rule && re.test(f.message))

test('dependency rule: domain and application must not reach outward', () => {
  assert.ok(has('DEP', /domain module imports infrastructure/))
  assert.ok(has('DEP', /PlaceOrder \(application\) composes SqlOrderRepository/))
  assert.ok(!has('DEP', /^adapters module imports infrastructure/), 'outer ring may use infrastructure')
})

test('each SOLID principle catches its planted violation', () => {
  assert.ok(has('SRP', /ShopManager has 12 public methods/))
  assert.ok(has('SRP', /ShopManager has \d+ unrelated method groups/))
  assert.ok(has('OCP', /PaymentFeeCalculator switches on/))
  assert.ok(has('LSP', /GiftCardPayment\.refund raises NotImplementedError/))
  assert.ok(has('ISP', /StoreAdmin declares 8 methods/))
  assert.ok(has('ISP', /BasicStoreAdmin stubs 6 of 8/))
  assert.ok(has('DIP', /PlaceOrder depends on concrete SqlOrderRepository/))
})

test('clean classes stay clean', () => {
  for (const name of ['Money', 'StripeGateway', 'CheckoutService']) {
    const c = model.classes.find((x) => x.name === name)
    assert.ok(c, `${name} extracted`)
    assert.deepEqual(findings.filter((f) => f.classId === c.id).map((f) => f.message), [])
  }
})
