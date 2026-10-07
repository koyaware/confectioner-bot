import { Bot } from 'grammy';
import { canAccessOwner } from '../permissions.js';
import { BotContextWithSession } from '../context.js';
import { decodeCallback } from '../callbacks.js';
import { beginOwnerDraft } from './edit-field.js';
import { escapeHtml } from '../../domain/escape.js';
import { formatMinor } from '../../lib/money.js';
import {
  listProductsAll,
  getProductById,
  listProductOptionsAll,
  getCategoryById,
  listCategoriesAll,
} from '../../services/catalog.js';
import {
  setCategoryActive,
  moveCategory,
  deleteCategory,
  setProductActive,
  moveProduct,
  deleteProduct,
  setOptionActive,
  deleteOption,
} from '../../services/catalog-editor.js';
import { InlineKeyboard } from '../../telegram/port.js';

async function showCategoryList(ctx: BotContextWithSession, edit = true) {
  const cats = await listCategoriesAll(ctx.tenant.id);
  const rows: InlineKeyboard['inline_keyboard'] = cats.map((c: { id: string; title: string }) => [
    { text: c.title, callback_data: `adm:cat:edit:${c.id}` },
  ]);
  rows.push([{ text: ctx.t.ownerCatalog.addCategory, callback_data: 'adm:cat:add' }]);
  rows.push([{ text: ctx.t.common.back, callback_data: 'adm:menu' }]);

  const text = ctx.t.ownerCatalog.categoriesTitle;
  const chatId = ctx.callbackQuery?.message?.chat.id ?? ctx.chat?.id;
  const messageId = ctx.callbackQuery?.message?.message_id;
  if (edit && chatId && messageId) {
    await ctx.port.editMessageTextOrSend(chatId, messageId, text, {
      keyboard: { inline_keyboard: rows },
    });
  } else if (chatId) {
    await ctx.port.sendMessage(chatId, text, { keyboard: { inline_keyboard: rows } });
  }
}

async function showCategoryEdit(ctx: BotContextWithSession, categoryId: string) {
  const category = await getCategoryById(ctx.tenant.id, categoryId);
  if (!category) {
    await showCategoryList(ctx);
    return;
  }
  const toggleLabel = category.isActive ? ctx.t.ownerCatalog.hide : ctx.t.ownerCatalog.show;
  const rows: InlineKeyboard['inline_keyboard'] = [
    [{ text: ctx.t.ownerCatalog.rename, callback_data: `adm:cat:rename:${categoryId}` }],
    [{ text: toggleLabel, callback_data: `adm:cat:toggle:${categoryId}` }],
    [
      { text: ctx.t.ownerCatalog.up, callback_data: `adm:cat:up:${categoryId}` },
      { text: ctx.t.ownerCatalog.down, callback_data: `adm:cat:down:${categoryId}` },
    ],
    [{ text: ctx.t.ownerCatalog.products, callback_data: `adm:prd:list:${categoryId}` }],
    [{ text: ctx.t.ownerCatalog.delete, callback_data: `adm:cat:del:${categoryId}` }],
    [{ text: ctx.t.catalog.back, callback_data: 'adm:cat:list' }],
  ];
  const text = `${ctx.t.ownerCatalog.categoryTitle} «${escapeHtml(category.title)}»\n${category.isActive ? ctx.t.ownerCatalog.active : ctx.t.ownerCatalog.hidden}`;
  const chatId = ctx.callbackQuery?.message?.chat.id ?? ctx.chat?.id;
  const messageId = ctx.callbackQuery?.message?.message_id;
  if (chatId && messageId) {
    await ctx.port.editMessageTextOrSend(chatId, messageId, text, {
      keyboard: { inline_keyboard: rows },
    });
  }
}

async function showProductList(ctx: BotContextWithSession, categoryId: string) {
  const category = await getCategoryById(ctx.tenant.id, categoryId);
  if (!category) {
    await showCategoryList(ctx);
    return;
  }
  const prods = await listProductsAll(ctx.tenant.id, categoryId);
  const rows: InlineKeyboard['inline_keyboard'] = prods.map((p: { id: string; title: string }) => [
    { text: p.title, callback_data: `adm:prd:edit:${p.id}` },
  ]);
  rows.push([{ text: ctx.t.ownerCatalog.addProduct, callback_data: `adm:prd:add:${categoryId}` }]);
  rows.push([{ text: ctx.t.catalog.back, callback_data: `adm:cat:edit:${categoryId}` }]);

  const chatId = ctx.callbackQuery?.message?.chat.id ?? ctx.chat?.id;
  const messageId = ctx.callbackQuery?.message?.message_id;
  const text = `${ctx.t.ownerCatalog.productsTitle}: ${escapeHtml(category.title)}`;
  if (chatId && messageId) {
    await ctx.port.editMessageTextOrSend(chatId, messageId, text, {
      keyboard: { inline_keyboard: rows },
    });
  }
}

async function showProductEdit(ctx: BotContextWithSession, productId: string) {
  const product = await getProductById(ctx.tenant.id, productId);
  if (!product) {
    await showCategoryList(ctx);
    return;
  }
  const productOptionsList = await listProductOptionsAll(productId);
  const optionCount = productOptionsList.length;

  const rows: InlineKeyboard['inline_keyboard'] = [
    [{ text: ctx.t.ownerCatalog.fieldTitle, callback_data: `adm:prd:field:${productId}:title` }],
    [
      {
        text: ctx.t.ownerCatalog.fieldDesc,
        callback_data: `adm:prd:field:${productId}:description`,
      },
    ],
    [{ text: ctx.t.ownerCatalog.fieldPrice, callback_data: `adm:prd:field:${productId}:price` }],
    [{ text: ctx.t.ownerCatalog.fieldUnit, callback_data: `adm:prd:field:${productId}:unit` }],
    [{ text: ctx.t.ownerCatalog.fieldLead, callback_data: `adm:prd:field:${productId}:lead` }],
    [
      {
        text: ctx.t.ownerCatalog.fieldCapacity,
        callback_data: `adm:prd:field:${productId}:capacity`,
      },
    ],
    [{ text: ctx.t.ownerCatalog.fieldPhoto, callback_data: `adm:prd:field:${productId}:photo` }],
    [
      {
        text: `${ctx.t.ownerCatalog.options} (${optionCount})`,
        callback_data: `adm:prd:opt:${productId}`,
      },
    ],
    [
      {
        text: product.isActive ? ctx.t.ownerCatalog.hide : ctx.t.ownerCatalog.show,
        callback_data: `adm:prd:toggle:${productId}`,
      },
    ],
    [
      { text: ctx.t.ownerCatalog.up, callback_data: `adm:prd:up:${productId}` },
      { text: ctx.t.ownerCatalog.down, callback_data: `adm:prd:down:${productId}` },
    ],
    [{ text: ctx.t.ownerCatalog.delete, callback_data: `adm:prd:del:${productId}` }],
    [{ text: ctx.t.catalog.back, callback_data: `adm:prd:list:${product.categoryId}` }],
  ];

  const text =
    `<b>${escapeHtml(product.title)}</b>\n` +
    `${product.description ? escapeHtml(product.description) + '\n' : ''}` +
    `${ctx.t.ownerCatalog.priceLabel}: ${formatMinor(product.priceMinor, ctx.tenant.currency)}\n` +
    `${ctx.t.ownerCatalog.unitLabel}: ${escapeHtml(product.unit)}\n` +
    `${ctx.t.ownerCatalog.leadLabel}: ${product.leadDays ?? '—'}\n` +
    `${ctx.t.ownerCatalog.capacityLabel}: ${product.capacityUnits}\n` +
    `${product.isActive ? ctx.t.ownerCatalog.active : ctx.t.ownerCatalog.hidden}`;

  const chatId = ctx.callbackQuery?.message?.chat.id ?? ctx.chat?.id;
  const messageId = ctx.callbackQuery?.message?.message_id;
  if (chatId && messageId) {
    await ctx.port.editMessageTextOrSend(chatId, messageId, text, {
      keyboard: { inline_keyboard: rows },
    });
  }
}

async function showOptionList(ctx: BotContextWithSession, productId: string) {
  const product = await getProductById(ctx.tenant.id, productId);
  if (!product) {
    const chatId = ctx.callbackQuery?.message?.chat.id ?? ctx.chat?.id;
    const messageId = ctx.callbackQuery?.message?.message_id;
    if (chatId && messageId) {
      await ctx.port.editMessageTextOrSend(chatId, messageId, ctx.t.product.notFound, {});
    }
    return;
  }
  const opts = await listProductOptionsAll(productId);
  const rows: InlineKeyboard['inline_keyboard'] = [];
  for (const o of opts) {
    rows.push([
      {
        text: `${o.isActive ? '' : '🙈 '}${o.groupTitle}: ${o.title}`,
        callback_data: `adm:prd:opttoggle:${productId}:${o.id}`,
      },
      {
        text: ctx.t.ownerCatalog.delete,
        callback_data: `adm:prd:optdel:${productId}:${o.id}`,
      },
    ]);
  }
  rows.push([{ text: ctx.t.ownerCatalog.addOption, callback_data: `adm:prd:optadd:${productId}` }]);
  rows.push([{ text: ctx.t.catalog.back, callback_data: `adm:prd:edit:${productId}` }]);

  const chatId = ctx.callbackQuery?.message?.chat.id ?? ctx.chat?.id;
  const messageId = ctx.callbackQuery?.message?.message_id;
  if (chatId && messageId) {
    await ctx.port.editMessageTextOrSend(chatId, messageId, ctx.t.ownerCatalog.optionsTitle, {
      keyboard: { inline_keyboard: rows },
    });
  }
}

export function registerOwnerCatalogHandlers(bot: Bot<BotContextWithSession>): void {
  bot.callbackQuery(/^adm:(cat|prd):/, async (ctx) => {
    if (!canAccessOwner(ctx)) {
      await ctx.port.answerCallback(ctx.callbackQuery.id, ctx.t.ownerCatalog.notOwner);
      return;
    }
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const decoded = decodeCallback(ctx.callbackQuery.data);
    if (!decoded.ok || decoded.value.ns !== 'adm') return;
    const { area, action, arg, arg2 } = decoded.value;

    if (area === 'cat') {
      if (action === 'list') return showCategoryList(ctx);
      if (action === 'add') {
        beginOwnerDraft(ctx, { kind: 'cat_add' });
        await ctx.port.editMessageTextOrSend(
          ctx.callbackQuery.message!.chat.id,
          ctx.callbackQuery.message!.message_id,
          ctx.t.ownerCatalog.promptCategoryTitle
        );
        return;
      }
      if (action === 'rename' && arg) {
        beginOwnerDraft(ctx, { kind: 'cat_rename', targetId: arg });
        await ctx.port.editMessageTextOrSend(
          ctx.callbackQuery.message!.chat.id,
          ctx.callbackQuery.message!.message_id,
          ctx.t.ownerCatalog.promptCategoryTitle
        );
        return;
      }
      if (action === 'edit' && arg) return showCategoryEdit(ctx, arg);
      if (action === 'toggle' && arg) {
        const dbCat = await getCategoryById(ctx.tenant.id, arg);
        await setCategoryActive(ctx.tenant.id, arg, !(dbCat?.isActive ?? true));
        return showCategoryEdit(ctx, arg);
      }
      if (action === 'up' && arg) {
        await moveCategory(ctx.tenant.id, arg, 'up');
        return showCategoryEdit(ctx, arg);
      }
      if (action === 'down' && arg) {
        await moveCategory(ctx.tenant.id, arg, 'down');
        return showCategoryEdit(ctx, arg);
      }
      if (action === 'del' && arg) {
        const res = await deleteCategory(ctx.tenant.id, arg);
        if (!res.ok) {
          await showCategoryList(ctx);
          return;
        }
        return showCategoryList(ctx);
      }
      return;
    }

    // prd area
    if (action === 'list' && arg) return showProductList(ctx, arg);
    if (action === 'add' && arg) {
      beginOwnerDraft(ctx, { kind: 'prd_add_title', targetId: arg });
      await ctx.port.editMessageTextOrSend(
        ctx.callbackQuery.message!.chat.id,
        ctx.callbackQuery.message!.message_id,
        ctx.t.ownerCatalog.promptProductTitle
      );
      return;
    }
    if (action === 'edit' && arg) return showProductEdit(ctx, arg);
    if (action === 'toggle' && arg) {
      const product = await getProductById(ctx.tenant.id, arg);
      await setProductActive(ctx.tenant.id, arg, !(product?.isActive ?? true));
      return showProductEdit(ctx, arg);
    }
    if (action === 'up' && arg) {
      await moveProduct(ctx.tenant.id, arg, 'up');
      return showProductEdit(ctx, arg);
    }
    if (action === 'down' && arg) {
      await moveProduct(ctx.tenant.id, arg, 'down');
      return showProductEdit(ctx, arg);
    }
    if (action === 'del' && arg) {
      const product = await getProductById(ctx.tenant.id, arg);
      await deleteProduct(ctx.tenant.id, arg);
      return showProductList(ctx, product?.categoryId ?? '');
    }
    if (action === 'field' && arg && arg2) {
      beginOwnerDraft(ctx, { kind: 'prd_field', targetId: arg, extra: { field: arg2 } });
      const fieldLabels: Record<string, string> = {
        title: ctx.t.ownerCatalog.fieldTitle,
        description: ctx.t.ownerCatalog.fieldDesc,
        price: ctx.t.ownerCatalog.fieldPrice,
        unit: ctx.t.ownerCatalog.fieldUnit,
        lead: ctx.t.ownerCatalog.fieldLead,
        capacity: ctx.t.ownerCatalog.fieldCapacity,
        photo: ctx.t.ownerCatalog.fieldPhoto,
      };
      const label = fieldLabels[arg2] ?? arg2;
      await ctx.port.editMessageTextOrSend(
        ctx.callbackQuery.message!.chat.id,
        ctx.callbackQuery.message!.message_id,
        `${ctx.t.ownerCatalog.promptField}: ${label}`
      );
      return;
    }
    if (action === 'opt' && arg) return showOptionList(ctx, arg);
    if (action === 'optadd' && arg) {
      beginOwnerDraft(ctx, { kind: 'opt_add_group', targetId: arg });
      await ctx.port.editMessageTextOrSend(
        ctx.callbackQuery.message!.chat.id,
        ctx.callbackQuery.message!.message_id,
        ctx.t.ownerCatalog.promptOptionGroup
      );
      return;
    }
    if (action === 'optdel' && arg && arg2) {
      await deleteOption(ctx.tenant.id, arg2);
      return showOptionList(ctx, arg);
    }
    if (action === 'opttoggle' && arg && arg2) {
      const opts = await listProductOptionsAll(arg);
      const opt = opts.find((o: { id: string }) => o.id === arg2);
      if (opt) {
        await setOptionActive(ctx.tenant.id, arg2, !opt.isActive);
      }
      return showOptionList(ctx, arg);
    }
  });
}
