import React from "react";
import { shallow } from "enzyme";
import ReaderConfig from "./ReaderConfig";

describe("ReaderConfig", () => {
  test("matches snapshot", () => {
    const wrapper = shallow(<ReaderConfig />);
    expect(wrapper).toMatchSnapshot();
  });
});
