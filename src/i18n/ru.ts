export const ru = {
  start: {
    greeting: (shopName: string) => `Привет! Я бот магазина «${shopName}». Выберите раздел ниже.`,
    buttonCatalog: 'Каталог',
    claimSuccess: (shopName: string) =>
      `Готово! Вы теперь владелец магазина «${shopName}». /menu покажет меню владельца.`,
    claimInvalid: 'Ссылка для привязки недействительна.',
    claimExpired: 'Ссылка для привязки истекла.',
    claimUsed: 'Эта ссылка уже была использована.',
  },
  catalog: {
    title: 'Каталог',
    empty: 'В магазине пока нет категорий.',
    categoriesEmpty: 'Категории не найдены.',
    productsEmpty: 'В этой категории пока нет товаров.',
    back: 'Назад',
    backToCatalog: 'К каталогу',
    perUnit: (currency: string) => `за ${currency === '₽' ? 'шт.' : 'единицу'}`,
  },
  product: {
    notFound: 'Товар не найден.',
    options: 'Опции:',
    noOptions: 'Без дополнительных опций',
  },
  common: {
    error: 'Произошла ошибка. Попробуйте позже.',
  },
  menu: {
    customerTitle: 'Главное меню',
    ownerTitle: 'Меню владельца',
    ownerSections: {
      orders: 'Заказы',
      catalog: 'Каталог',
      calendar: 'Календарь',
      settings: 'Настройки',
      links: 'Ссылки для Instagram',
      stats: 'Статистика',
      preview: 'Как видит клиент',
    },
  },
};
