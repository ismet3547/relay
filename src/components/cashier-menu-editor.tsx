"use client";
import { useState } from "react";
import { Check, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { CashierController } from "@/hooks/use-cashier";
import { categories, MenuProduct, money } from "@/lib/cashier";

export function PriceInput({
  value,
  onChange,
  label = "Price ($)",
}: {
  value: number;
  onChange: (minor: number) => void;
  label?: string;
}) {
  const [text, setText] = useState((value / 100).toFixed(2));
  return (
    <label>
      {label}
      <input
        aria-label={label}
        inputMode="decimal"
        pattern="[0-9]+(\.[0-9]{1,2})?"
        required
        maxLength={8}
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          if (/^\d+(\.\d{1,2})?$/.test(v)) {
            const [major, minor = ""] = v.split(".");
            onChange(Number(major) * 100 + Number(minor.padEnd(2, "0")));
          }
        }}
      />
    </label>
  );
}
const list = (value: string) =>
  value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
function ListInput({
  value,
  onChange,
  label,
  multiline = false,
}: {
  value: string[];
  onChange: (values: string[]) => void;
  label: string;
  multiline?: boolean;
}) {
  const [text, setText] = useState(value.join(", "));
  const props = {
    value: text,
    onChange: (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      setText(e.target.value);
      onChange(list(e.target.value));
    },
  };
  return (
    <label>
      {label}
      {multiline ? (
        <textarea rows={2} maxLength={1200} {...props} />
      ) : (
        <input maxLength={600} {...props} />
      )}
    </label>
  );
}
const uid = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
export function MenuEditor({ cashier }: { cashier: CashierController }) {
  const [products, setProducts] = useState(() =>
    structuredClone(cashier.overview!.products),
  );
  const [revision, setRevision] = useState(cashier.overview!.menuRevision);
  const [selected, setSelected] = useState(products[0].id);
  const [saved, setSaved] = useState(false);
  const product = products.find((p) => p.id === selected)!;
  function edit(change: Partial<MenuProduct>) {
    setSaved(false);
    setProducts((previous) =>
      previous.map((p) => (p.id === selected ? { ...p, ...change } : p)),
    );
  }
  async function reload() {
    const next = await cashier.refresh();
    setProducts(structuredClone(next.products));
    setRevision(next.menuRevision);
    setSelected(next.products[0].id);
    setSaved(false);
  }
  async function save() {
    const next = await cashier.saveMenu(products, revision);
    if (next) {
      setProducts(structuredClone(next.products));
      setRevision(next.menuRevision);
      setSaved(true);
    }
  }
  return (
    <div className="menu-editor-layout">
      <aside className="panel menu-editor-list">
        <div className="panel-heading">
          <h2>Menu products</h2>
          <span className="count-tag">{products.length}</span>
        </div>
        {products.map((p) => (
          <button
            key={p.id}
            className={selected === p.id ? "selected" : ""}
            onClick={() => {
              setSelected(p.id);
              setSaved(false);
            }}
          >
            <span>
              <strong>{p.name}</strong>
              <small>
                {p.category} · {p.available ? "Available" : "Sold out"}
              </small>
            </span>
            <span>{money(p.priceMinor)}</span>
          </button>
        ))}
        <button
          className="menu-add"
          onClick={() => {
            const id = uid("product");
            setProducts([
              ...products,
              {
                id,
                name: "New product",
                description: "",
                aliases: [],
                category: "Burgers",
                priceMinor: 500,
                available: true,
                options: [],
                modifiers: [],
                ingredients: [],
                allergens: [],
              },
            ]);
            setSelected(id);
            setSaved(false);
          }}
        >
          <Plus size={15} />
          Add product
        </button>
      </aside>
      <form
        className="panel cashier-form menu-product-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="panel-heading">
          <div>
            <h2>Edit the restaurant menu</h2>
            <p>
              Changes apply to current carts. Saved orders keep their exact
              items and prices.
            </p>
          </div>
          <div className="cashier-form-actions">
            <button
              type="button"
              className="icon-button"
              title="Reload saved menu and discard unsaved edits"
              aria-label="Reload saved menu"
              onClick={() => void reload().catch(() => {})}
            >
              <RotateCcw size={16} />
            </button>
            <button
              className="button primary"
              disabled={cashier.busy}
              type="submit"
            >
              {saved ? <Check size={15} /> : <Save size={15} />}
              {saved ? "Saved" : "Save menu"}
            </button>
          </div>
        </div>
        <div className="cashier-form-body" key={`${selected}-${revision}`}>
          <div className="cashier-form-grid">
            <label>
              Product name
              <input
                required
                maxLength={100}
                value={product.name}
                onChange={(e) => edit({ name: e.target.value })}
              />
            </label>
            <label>
              Category
              <select
                value={product.category}
                onChange={(e) =>
                  edit({ category: e.target.value as MenuProduct["category"] })
                }
              >
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <PriceInput
              value={product.priceMinor}
              onChange={(priceMinor) => edit({ priceMinor })}
              label="Base price ($)"
            />
            <label className="cashier-checkbox">
              <input
                type="checkbox"
                checked={product.available}
                onChange={(e) => edit({ available: e.target.checked })}
              />
              Available to order
            </label>
          </div>
          <label>
            Description
            <textarea
              maxLength={500}
              rows={2}
              value={product.description}
              onChange={(e) => edit({ description: e.target.value })}
            />
          </label>
          <ListInput
            label="Also known as · comma separated"
            value={product.aliases}
            onChange={(aliases) => edit({ aliases })}
          />
          <div className="cashier-form-grid">
            <ListInput
              label="Ingredients · comma separated"
              value={product.ingredients}
              onChange={(ingredients) => edit({ ingredients })}
              multiline
            />
            <ListInput
              label="Known allergens · comma separated"
              value={product.allergens}
              onChange={(allergens) => edit({ allergens })}
              multiline
            />
          </div>
          <p className="cashier-footnote">
            Listed ingredients are informational. Cross-contact and complete
            allergen safety are not verified.
          </p>
          <div className="cashier-editor-section">
            <div>
              <h3>Selections</h3>
              <p>
                Size, combo drink, or flavor. Choose a default or require the
                customer to choose.
              </p>
            </div>
            <button
              type="button"
              className="text-button"
              disabled={product.options.length >= 6}
              onClick={() =>
                edit({
                  options: [
                    ...product.options,
                    {
                      id: uid("option"),
                      name: "Selection",
                      required: true,
                      choices: [
                        {
                          id: uid("choice"),
                          name: "Choice",
                          priceMinor: 0,
                          available: true,
                        },
                      ],
                    },
                  ],
                })
              }
            >
              <Plus size={14} />
              Add selection
            </button>
          </div>
          {product.options.map((group, gi) => {
            const changeGroup = (patch: Partial<typeof group>) =>
              edit({
                options: product.options.map((g, i) =>
                  i === gi ? { ...g, ...patch } : g,
                ),
              });
            return (
              <fieldset className="cashier-option-editor" key={group.id}>
                <legend>{group.name || "Selection"}</legend>
                <div className="cashier-form-grid">
                  <label>
                    Name
                    <input
                      required
                      maxLength={100}
                      value={group.name}
                      onChange={(e) => changeGroup({ name: e.target.value })}
                    />
                  </label>
                  <label>
                    Default choice
                    <select
                      value={group.defaultChoiceId || ""}
                      onChange={(e) =>
                        changeGroup({
                          defaultChoiceId: e.target.value || undefined,
                        })
                      }
                    >
                      <option value="">No default · ask if required</option>
                      {group.choices
                        .filter((c) => c.available)
                        .map((c) => (
                          <option value={c.id} key={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
                <div className="cashier-option-controls">
                  <label className="cashier-checkbox">
                    <input
                      type="checkbox"
                      checked={group.required}
                      onChange={(e) =>
                        changeGroup({ required: e.target.checked })
                      }
                    />
                    Selection required
                  </label>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      edit({
                        options: product.options.filter((_, i) => i !== gi),
                      })
                    }
                  >
                    <Trash2 size={13} />
                    Remove selection
                  </button>
                </div>
                {group.choices.map((choice, ci) => {
                  const changeChoice = (patch: Partial<typeof choice>) =>
                    changeGroup({
                      choices: group.choices.map((c, i) =>
                        i === ci ? { ...c, ...patch } : c,
                      ),
                      ...(patch.available === false &&
                      group.defaultChoiceId === choice.id
                        ? { defaultChoiceId: undefined }
                        : {}),
                    });
                  return (
                    <div className="cashier-choice-row" key={choice.id}>
                      <label>
                        Choice name
                        <input
                          required
                          maxLength={100}
                          value={choice.name}
                          onChange={(e) =>
                            changeChoice({ name: e.target.value })
                          }
                        />
                      </label>
                      <PriceInput
                        value={choice.priceMinor}
                        onChange={(priceMinor) => changeChoice({ priceMinor })}
                        label="Extra ($)"
                      />
                      <label className="cashier-checkbox">
                        <input
                          type="checkbox"
                          checked={choice.available}
                          onChange={(e) =>
                            changeChoice({ available: e.target.checked })
                          }
                        />
                        Available
                      </label>
                      <button
                        type="button"
                        className="icon-button"
                        disabled={group.choices.length <= 1}
                        aria-label={`Remove ${choice.name} choice`}
                        onClick={() =>
                          changeGroup({
                            choices: group.choices.filter((_, i) => i !== ci),
                            ...(group.defaultChoiceId === choice.id
                              ? { defaultChoiceId: undefined }
                              : {}),
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
                <button
                  type="button"
                  className="text-button"
                  disabled={group.choices.length >= 12}
                  onClick={() =>
                    changeGroup({
                      choices: [
                        ...group.choices,
                        {
                          id: uid("choice"),
                          name: "New choice",
                          priceMinor: 0,
                          available: true,
                        },
                      ],
                    })
                  }
                >
                  <Plus size={13} />
                  Add choice
                </button>
              </fieldset>
            );
          })}
          <div className="cashier-editor-section">
            <div>
              <h3>Modifications & extras</h3>
              <p>
                Ingredient removals and paid additions supported by this
                product.
              </p>
            </div>
            <button
              type="button"
              className="text-button"
              disabled={product.modifiers.length >= 12}
              onClick={() =>
                edit({
                  modifiers: [
                    ...product.modifiers,
                    {
                      id: uid("extra"),
                      name: "New modification",
                      priceMinor: 0,
                    },
                  ],
                })
              }
            >
              <Plus size={14} />
              Add modification
            </button>
          </div>
          {product.modifiers.map((modifier, mi) => {
            const change = (patch: Partial<typeof modifier>) =>
              edit({
                modifiers: product.modifiers.map((m, i) =>
                  i === mi ? { ...m, ...patch } : m,
                ),
              });
            return (
              <div
                className="cashier-choice-row modifier-row"
                key={modifier.id}
              >
                <label>
                  Modification name
                  <input
                    required
                    maxLength={100}
                    value={modifier.name}
                    onChange={(e) => change({ name: e.target.value })}
                  />
                </label>
                <PriceInput
                  value={modifier.priceMinor}
                  onChange={(priceMinor) => change({ priceMinor })}
                  label="Extra ($)"
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove ${modifier.name} modification`}
                  onClick={() =>
                    edit({
                      modifiers: product.modifiers.filter((_, i) => i !== mi),
                    })
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
          <div className="cashier-menu-meta">
            <span>
              Product ID: <code>{product.id}</code> · menu revision {revision}
            </span>
            <button
              type="button"
              className="text-button"
              disabled={products.length <= 1}
              onClick={() => {
                const next = products.filter((p) => p.id !== selected);
                setProducts(next);
                setSelected(next[0].id);
                setSaved(false);
              }}
            >
              <Trash2 size={13} />
              Delete product from draft
            </button>
          </div>
          <p className="cashier-footnote">
            Edits stay in this form until Save menu. Reload restores the saved
            menu. Active cart controls are recorded as customer actions.
          </p>
        </div>
      </form>
    </div>
  );
}
