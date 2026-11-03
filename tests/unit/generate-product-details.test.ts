import { describe, expect, it } from 'vitest';
import { generateProductDetails } from '../../src/lib/generate-product-details';

describe('product details copy', () => {
  it('preserves the fixed copy and inserts all dimensions', () => {
    expect(generateProductDetails({ lengthMm: 11.25, widthMm: 8, heightMm: 5.5 }))
      .toBe(`关于尺寸（单位为mm）
 - 配上925银托后尺寸为：11.25x8x5.5(厚度)
关于定价：
- 可单拍水晶蛋面，价格为商品链接中的价格
- 也可后台联系小客服做定制，定制价格为首页置顶笔记。（过往成品展示可移步 @豆子丨祝余 IWISH ）
关于发货：
- 天然水晶，默认微瑕，如对产品有任何疑问可在发货前联系客服360度查看
- 发货后，为了您和其他消费者的权益，无鉴赏期不支持退换，感谢理解～
用心做水晶，支持原创～`);
  });

  it('keeps the dimension positions when values are missing', () => {
    expect(generateProductDetails({ lengthMm: 11, heightMm: 5 })).toContain('11x待补充x5(厚度)');
  });

  it.each([null, undefined, {}, { lengthMm: null, widthMm: null, heightMm: null }])(
    'omits the size section when all dimensions are missing: %j',
    (measurement) => {
      const content = generateProductDetails(measurement);
      expect(content.startsWith('关于定价：')).toBe(true);
      expect(content).not.toContain('关于尺寸');
      expect(content).not.toContain('配上925银托后尺寸为');
      expect(content).not.toContain('待补充');
    },
  );

  it('inserts the setting section immediately after the dimensions', () => {
    expect(generateProductDetails({ lengthMm: 11, heightMm: 5 }, '花朵魔盒')).toContain(
      '配上925银托后尺寸为：11x待补充x5(厚度)\n关于镶嵌：\n- 镶嵌花朵魔盒\n关于定价：',
    );
  });

  it('includes the setting even without dimensions', () => {
    expect(generateProductDetails(null, ' 花朵魔盒 ')).toBe(
      `关于镶嵌：\n- 镶嵌花朵魔盒\n${generateProductDetails(null)}`,
    );
  });

  it.each([null, undefined, '', '   '])('omits an empty setting: %j', (setting) => {
    expect(generateProductDetails({ widthMm: 8 }, setting)).not.toContain('关于镶嵌');
  });
});
