export const ru = {
  start: {
    greeting: (shopName: string) => `Привет! Я бот магазина «${shopName}». Выберите раздел ниже.`,
    buttonCatalog: 'Каталог',
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
};
