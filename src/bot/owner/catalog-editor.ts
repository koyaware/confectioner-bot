import { Bot } from 'grammy';
import { BotContextWithSession } from '../context.js';
import { decodeCallback } from '../callbacks.js';
import { ru } from '../../i18n/ru.js';
import { escapeHtml } from '../../domain/escape.js';
import { formatMinor } from '../../lib/money.js';
import {
  listProductsAll,
  getProductById,
  listProductOptions,
  getCategoryById,
  listCategoriesAll,
} from '../../services/catalog.js';
import * as editor from '../../services/catalog-editor.js';
import { InlineKeyboard } from '../../telegram/port.js';

async function showCategoryList(ctx: BotContextWithSession, edit = true) {
  const cats = await listCategoriesAll(ctx.tenant.id);
  const rows: InlineKeyboard['inline_keyboard'] = cats.map((c) => [
    { text: c.title, callback_data: `adm:cat:edit:${c.id}` },
  ]);
  rows.push([{ text: ru.ownerCatalog.addCategory, callback_data: 'adm:cat:add' }]);

  const text = ru.ownerCatalog.categoriesTitle;
  const chatId = ctx.callbackQuery?.message?.chat.id ?? ctx.chat?.id;
  const messageId = ctx.callbackQuery?.message?.message_id;
  if (edit && chatId && messageId) {
    await ctx.port.editMessageText(chatId, messageId, text, {
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
  const toggleLabel = category.isActive ? ru.ownerCatalog.hide : ru.ownerCatalog.show;
  const rows: InlineKeyboard['inline_keyboard'] = [
    [{ text: ru.ownerCatalog.rename, callback_data: `adm:cat:rename:${categoryId}` }],
    [{ text: toggleLabel, callback_data: `adm:cat:toggle:${categoryId}` }],
    [
      { text: ru.ownerCatalog.up, callback_data: `adm:cat:up:${categoryId}` },
      { text: ru.ownerCatalog.down, callback_data: `adm:cat:down:${categoryId}` },
    ],
    [{ text: ru.ownerCatalog.products, callback_data: `adm:prd:list:${categoryId}` }],
    [{ text: ru.ownerCatalog.delete, callback_data: `adm:cat:del:${categoryId}` }],
    [{ text: ru.catalog.back, callback_data: 'adm:cat:list' }],
  ];
  const text = `${ru.ownerCatalog.categoryTitle} «${escapeHtml(category.title)}»\n${category.isActive ? ru.ownerCatalog.active : ru.ownerCatalog.hidden}`;
  const chatId = ctx.callbackQuery?.message?.chat.id ?? ctx.chat?.id;
  const messageId = ctx.callbackQuery?.message?.message_id;
  if (chatId && messageId) {
    await ctx.port.editMessageText(chatId, messageId, text, {
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
  const rows: InlineKeyboard['inline_keyboard'] = prods.map((p) => [
    { text: p.title, callback_data: `adm:prd:edit:${p.id}` },
  ]);
  rows.push([{ text: ru.ownerCatalog.addProduct, callback_data: `adm:prd:add:${categoryId}` }]);
  rows.push([{ text: ru.catalog.back, callback_data: `adm:cat:edit:${categoryId}` }]);

  const chatId = ctx.callbackQuery?.message?.chat.id ?? ctx.chat?.id;
  const messageId = ctx.callbackQuery?.message?.message_id;
  const text = `${ru.ownerCatalog.productsTitle}: ${escapeHtml(category.title)}`;
  if (chatId && messageId) {
    await ctx.port.editMessageText(chatId, messageId, text, {
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
  const productOptionsList = await listProductOptions(productId);
  const optionCount = productOptionsList.length;

  const rows: InlineKeyboard['inline_keyboard'] = [
    [{ text: ru.ownerCatalog.fieldTitle, callback_data: `adm:prd:field:${productId}:title` }],
    [{ text: ru.ownerCatalog.fieldDesc, callback_data: `adm:prd:field:${productId}:description` }],
    [{ text: ru.ownerCatalog.fieldPrice, callback_data: `adm:prd:field:${productId}:price` }],
    [{ text: ru.ownerCatalog.fieldUnit, callback_data: `adm:prd:field:${productId}:unit` }],
    [{ text: ru.ownerCatalog.fieldLead, callback_data: `adm:prd:field:${productId}:lead` }],
    [{ text: ru.ownerCatalog.fieldCapacity, callback_data: `adm:prd:field:${productId}:capacity` }],
    [{ text: ru.ownerCatalog.fieldPhoto, callback_data: `adm:prd:field:${productId}:photo` }],
    [
      {
        text: `${ru.ownerCatalog.options} (${optionCount})`,
        callback_data: `adm:prd:opt:${productId}`,
      },
    ],
    [
      {
        text: product.isActive ? ru.ownerCatalog.hide : ru.ownerCatalog.show,
        callback_data: `adm:prd:toggle:${productId}`,
      },
    ],
    [
      { text: ru.ownerCatalog.up, callback_data: `adm:prd:up:${productId}` },
      { text: ru.ownerCatalog.down, callback_data: `adm:prd:down:${productId}` },
    ],
    [{ text: ru.ownerCatalog.delete, callback_data: `adm:prd:del:${productId}` }],
    [{ text: ru.catalog.back, callback_data: `adm:prd:list:${product.categoryId}` }],
  ];

  const text =
    `<b>${escapeHtml(product.title)}</b>\n` +
    `${product.description ? escapeHtml(product.description) + '\n' : ''}` +
    `${ru.ownerCatalog.priceLabel}: ${formatMinor(product.priceMinor, ctx.tenant.currency)}\n` +
    `${ru.ownerCatalog.unitLabel}: ${escapeHtml(product.unit)}\n` +
    `${ru.ownerCatalog.leadLabel}: ${product.leadDays ?? '—'}\n` +
    `${ru.ownerCatalog.capacityLabel}: ${product.capacityUnits}\n` +
    `${product.isActive ? ru.ownerCatalog.active : ru.ownerCatalog.hidden}`;

  const chatId = ctx.callbackQuery?.message?.chat.id ?? ctx.chat?.id;
  const messageId = ctx.callbackQuery?.message?.message_id;
  if (chatId && messageId) {
    await ctx.port.editMessageText(chatId, messageId, text, {
      keyboard: { inline_keyboard: rows },
    });
  }
}

async function showOptionList(ctx: BotContextWithSession, productId: string) {
  const opts = await listProductOptions(productId);
  const rows: InlineKeyboard['inline_keyboard'] = [];
  for (const o of opts) {
    rows.push([
      {
        text: `${o.groupTitle}: ${o.title}`,
        callback_data: `adm:prd:opttoggle:${productId}:${o.id}`,
      },
      { text: 'Удалить', callback_data: `adm:prd:optdel:${productId}:${o.id}` },
    ]);
  }
  rows.push([{ text: ru.ownerCatalog.addOption, callback_data: `adm:prd:optadd:${productId}` }]);
  rows.push([{ text: ru.catalog.back, callback_data: `adm:prd:edit:${productId}` }]);

  const chatId = ctx.callbackQuery?.message?.chat.id ?? ctx.chat?.id;
  const messageId = ctx.callbackQuery?.message?.message_id;
  if (chatId && messageId) {
    await ctx.port.editMessageText(chatId, messageId, ru.ownerCatalog.optionsTitle, {
      keyboard: { inline_keyboard: rows },
    });
  }
}

const PRODUCT_FIELD_LABELS: Record<string, string> = {
  title: 'Название',
  description: 'Описание',
  price: 'Цена в рублях',
  unit: 'Единица',
  lead: 'Срок в днях',
  capacity: 'Занимает слотов',
  photo: 'Фото',
};

export function registerOwnerCatalogHandlers(bot: Bot<BotContextWithSession>): void {
  bot.callbackQuery(/^adm:(cat|prd):/, async (ctx) => {
    if (ctx.role !== 'owner') {
      await ctx.port.answerCallback(ctx.callbackQuery.id, ru.ownerCatalog.notOwner);
      return;
    }
    await ctx.port.answerCallback(ctx.callbackQuery.id);

    const decoded = decodeCallback(ctx.callbackQuery.data);
    if (!decoded.ok || decoded.value.ns !== 'adm') return;
    const { area, action, arg, arg2 } = decoded.value;

    if (area === 'cat') {
      if (action === 'list') return showCategoryList(ctx);
      if (action === 'add') {
        ctx.sessionState = 'owner.edit_field';
        ctx.session.ownerDraft = { kind: 'cat_add' };
        await ctx.port.editMessageText(
          ctx.callbackQuery.message!.chat.id,
          ctx.callbackQuery.message!.message_id,
          ru.ownerCatalog.promptCategoryTitle
        );
        return;
      }
      if (action === 'rename' && arg) {
        ctx.sessionState = 'owner.edit_field';
        ctx.session.ownerDraft = { kind: 'cat_rename', targetId: arg };
        await ctx.port.editMessageText(
          ctx.callbackQuery.message!.chat.id,
          ctx.callbackQuery.message!.message_id,
          ru.ownerCatalog.promptCategoryTitle
        );
        return;
      }
      if (action === 'edit' && arg) return showCategoryEdit(ctx, arg);
      if (action === 'toggle' && arg) {
        const dbCat = await getCategoryById(ctx.tenant.id, arg);
        await editor.setCategoryActive(ctx.tenant.id, arg, !(dbCat?.isActive ?? true));
        return showCategoryEdit(ctx, arg);
      }
      if (action === 'up' && arg) {
        await editor.moveCategory(ctx.tenant.id, arg, 'up');
        return showCategoryEdit(ctx, arg);
      }
      if (action === 'down' && arg) {
        await editor.moveCategory(ctx.tenant.id, arg, 'down');
        return showCategoryEdit(ctx, arg);
      }
      if (action === 'del' && arg) {
        const res = await editor.deleteCategory(ctx.tenant.id, arg);
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
      ctx.sessionState = 'owner.edit_field';
      ctx.session.ownerDraft = { kind: 'prd_add_title', targetId: arg };
      await ctx.port.editMessageText(
        ctx.callbackQuery.message!.chat.id,
        ctx.callbackQuery.message!.message_id,
        ru.ownerCatalog.promptProductTitle
      );
      return;
    }
    if (action === 'edit' && arg) return showProductEdit(ctx, arg);
    if (action === 'toggle' && arg) {
      const product = await getProductById(ctx.tenant.id, arg);
      await editor.setProductActive(ctx.tenant.id, arg, !(product?.isActive ?? true));
      return showProductEdit(ctx, arg);
    }
    if (action === 'up' && arg) {
      await editor.moveProduct(ctx.tenant.id, arg, 'up');
      return showProductEdit(ctx, arg);
    }
    if (action === 'down' && arg) {
      await editor.moveProduct(ctx.tenant.id, arg, 'down');
      return showProductEdit(ctx, arg);
    }
    if (action === 'del' && arg) {
      const product = await getProductById(ctx.tenant.id, arg);
      await editor.deleteProduct(ctx.tenant.id, arg);
      return showProductList(ctx, product?.categoryId ?? '');
    }
    if (action === 'field' && arg && arg2) {
      ctx.sessionState = 'owner.edit_field';
      ctx.session.ownerDraft = { kind: 'prd_field', targetId: arg, extra: { field: arg2 } };
      const label = PRODUCT_FIELD_LABELS[arg2] ?? arg2;
      await ctx.port.editMessageText(
        ctx.callbackQuery.message!.chat.id,
        ctx.callbackQuery.message!.message_id,
        `${ru.ownerCatalog.promptField}: ${label}`
      );
      return;
    }
    if (action === 'opt' && arg) return showOptionList(ctx, arg);
    if (action === 'optadd' && arg) {
      ctx.sessionState = 'owner.edit_field';
      ctx.session.ownerDraft = { kind: 'opt_add_group', targetId: arg };
      await ctx.port.editMessageText(
        ctx.callbackQuery.message!.chat.id,
        ctx.callbackQuery.message!.message_id,
        ru.ownerCatalog.promptOptionGroup
      );
      return;
    }
    if (action === 'optdel' && arg && arg2) {
      await editor.deleteOption(arg2);
      return showOptionList(ctx, arg);
    }
    if (action === 'opttoggle' && arg && arg2) {
      const opts = await listProductOptions(arg);
      const opt = opts.find((o) => o.id === arg2);
      if (opt) {
        await editor.setOptionActive(arg2, !opt.isActive);
      }
      return showOptionList(ctx, arg);
    }
  });
}
